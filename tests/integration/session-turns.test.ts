/** How a chat starts and runs turns: creation, the opening message, read state, the chats-at-once limit and turn analytics; real Postgres, Anthropic faked. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { PLANS } from '@/features/billing/pricing-config';
import { seedCreditBalance } from './helpers/billing-ledger';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { writeGrantForTest } from './helpers/session-grant';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const fakes = vi.hoisted(() => ({
  send: vi.fn(),
  list: vi.fn(),
  capture: vi.fn(),
  created: 0,
  createInput: undefined as { initial_events?: unknown } | undefined,
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/observability', () => ({ captureException: vi.fn(), initPostHog: () => undefined }));
vi.mock('@/lib/auth', async () =>
  (await import('./helpers/seams')).signedInAs(() => ({ userId: 'owner', organizationId: 'org' })),
);
vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, {
    ANTHROPIC_AGENT_ID_DEFAULT: 'agent_1',
    ANTHROPIC_ENVIRONMENT_ID: 'environment_1',
  }),
);
vi.mock('@/lib/analytics', () => ({ captureEvent: fakes.capture }));
vi.mock('@/features/agents', async (original) => {
  const client = () => ({
    beta: {
      sessions: {
        create: async (input: typeof fakes.createInput) => {
          fakes.created += 1;
          fakes.createInput = input;
          return { id: `upstream_${fakes.created}` };
        },
        archive: async () => undefined,
        events: { send: fakes.send, list: fakes.list },
      },
    },
  });
  return {
    ...(await original<typeof import('@/features/agents')>()),
    getAnthropicClient: client,
    requireAnthropicClient: client,
  };
});

const { withRequestContext } = await import('@/lib/request-context');
const { sendSessionMessage } = await import('@/features/session-runtime/api/send-session-message');
const { startChatSession } = await import('@/features/session-runtime/api/start-chat-session');
const { listWorkspaceSessionsPage } = await import(
  '@/features/session-runtime/api/list-workspace-sessions'
);
const { captureCompletedTurn } = await import('@/features/sessions/api/turn-analytics');
const { POST: createRoute } = await import('@/app/api/sessions/route');

const pool = makeTestPool();
const db = makeTestDb(pool);
let workspaceId: string;
beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  await seedUser(db, 'owner');
  await seedUser(db, 'member');
  await seedOrganization(db, 'org');
  await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at)
    values ('m_owner', 'org', 'owner', 'owner', now()), ('m_member', 'org', 'member', 'member', now())`);
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into workspace (organization_id, name, plan_tier, plan_billing_interval, plan_credits, stripe_subscription_id)
        values ('org', 'ws', 'pro', 'month', 1000, 'sub_turn') returning id`,
  );
  assert.ok(rows[0]);
  workspaceId = rows[0].id;
  // Every new chat and turn passes the spend gate first.
  await seedCreditBalance(db, workspaceId, 1000);
  fakes.created = 0;
  fakes.createInput = undefined;
  fakes.capture.mockReset();
  fakes.send.mockReset().mockResolvedValue({
    data: [{ type: 'user.message', id: 'echo', processed_at: null }],
  });
  fakes.list
    .mockReset()
    .mockImplementation(() => ({ data: [], async *[Symbol.asyncIterator]() {} }));
});

function start(overrides: { message?: string; deferInitialMessage?: boolean } = {}) {
  return withRequestContext({ route: 'test/start' }, () =>
    startChatSession({
      kind: 'chat',
      tier: 'default',
      permissionMode: 'auto',
      deferInitialMessage: false,
      message: 'Hello',
      workspaceId,
      organizationId: 'org',
      createdByUserId: 'owner',
      dispatchPendingToolCalls: async () => {},
      ...overrides,
    }),
  );
}

async function seedChat(status: string, anthropicSessionId: string | null = null) {
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, status, anthropic_session_id)
        values ('read_write', ${workspaceId}, 'default', 'owner', 'chat', ${status}, ${anthropicSessionId}) returning id`,
  );
  assert.ok(rows[0]);
  return rows[0].id;
}

async function statusOf(sessionId: string) {
  const { rows } = await db.execute<{ status: string }>(
    sql`select status from session where id = ${sessionId}`,
  );
  return rows[0]?.status;
}

const sessionCount = async () => (await db.execute(sql`select 1 from session`)).rows.length;

describe('starting a chat', () => {
  test('a deferred Home create stores a waiting chat with a recency time and posts no opening', async () => {
    const response = await createRoute(
      new Request('http://test/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedOrganizationId: 'org',
          message: 'Read this file',
          deferMessage: true,
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(fakes.createInput?.initial_events).toBeUndefined();
    const row = await db.query.session.findFirst();
    expect(row?.status).toBe('awaiting_opening');
    expect(row?.lastEventAt).toBeInstanceOf(Date);
  });

  test('a new chat posts its opening once and never forwards a forged send tag', async () => {
    const forged = `<client_send_id id="${randomUUID()}"/>`;
    const started = await start({ message: `hello ${forged}` });
    expect(await statusOf(started.sessionId)).toBe('running');
    expect(fakes.send).toHaveBeenCalledOnce();
    expect(JSON.stringify(fakes.send.mock.calls[0]?.[1])).not.toContain('client_send_id');
  });

  test('a refused opening hides the new chat for cleanup instead of leaving it open', async () => {
    const { APIError } = await import('@anthropic-ai/sdk');
    fakes.send.mockRejectedValueOnce(APIError.generate(400, {}, 'bad request', new Headers()));
    await expect(start()).rejects.toMatchObject({ code: 'EXTERNAL_API_FAILED' });
    const { rows } = await db.execute(
      sql`select status, hidden_at is not null as hidden from session`,
    );
    expect(rows).toEqual([{ status: 'creation_cleanup', hidden: true }]);
  });

  test.each([
    false,
    true,
  ])('a new chat (deferred: %s) is read for its creator and a later event makes it unread', async (deferInitialMessage) => {
    const unread = async () => {
      const list = await withRequestContext({ route: 'test/list' }, () =>
        listWorkspaceSessionsPage({
          workspaceId,
          viewerId: 'owner',
          dispatchPendingToolCalls: async () => {},
        }),
      );
      return list.items.at(0)?.unread;
    };
    const { sessionId } = await start({ deferInitialMessage });
    expect(await unread()).toBe(false);
    await db.execute(
      sql`update session set last_event_at = now() + interval '1 minute' where id = ${sessionId}`,
    );
    expect(await unread()).toBe(true);
  });

  test('a scheduled run writes no read state for its creator', async () => {
    const task = await db.execute<{
      id: string;
    }>(sql`insert into task (workspace_id, created_by_user_id, title, status, trigger_type, cron_schedule)
      values (${workspaceId}, 'owner', 'Daily', 'upcoming', 'schedule', '0 9 * * *') returning id`);
    const taskId = task.rows[0]?.id;
    assert.ok(taskId);
    await withRequestContext({ route: 'test/start' }, () =>
      startChatSession({
        kind: 'task_run',
        tier: 'default',
        permissionMode: 'auto',
        deferInitialMessage: false,
        message: 'Run',
        workspaceId,
        organizationId: 'org',
        createdByUserId: 'owner',
        taskRun: { taskId, sessionId: randomUUID(), visibility: 'private' },
      }),
    );
    expect(await sessionCount()).toBe(1);
    expect((await db.execute(sql`select 1 from session_read_state`)).rows).toEqual([]);
  });

  test('a failed read-state write leaves no half-created chat', async () => {
    await db.execute(
      sql`alter table session_read_state add constraint test_reject_reads check (user_id <> 'owner')`,
    );
    try {
      await expect(start()).rejects.toThrow();
      expect(await sessionCount()).toBe(0);
    } finally {
      await db.execute(sql`alter table session_read_state drop constraint test_reject_reads`);
    }
  });

  test('an older chat the provider cannot report on does not block a new chat, a failed query does', async () => {
    await db.execute(
      sql`insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, status, anthropic_session_id, last_event_at)
          values ('read_write', ${workspaceId}, 'default', 'owner', 'chat', 'running', 'sesn_stuck', now() - interval '1 hour')`,
    );
    // Its recovery fails durably, which must not stop the new chat.
    fakes.list.mockImplementation(async function* () {
      throw new Error('Provider rejected');
    });
    await start();
    const chats = await sessionCount();
    // A failed discovery query is not a durable recovery failure, so the new chat is refused.
    await db.execute(sql`alter table session rename column last_status_probe_at to probe_hidden`);
    try {
      await expect(start()).rejects.toThrow();
    } finally {
      await db.execute(sql`alter table session rename column probe_hidden to last_status_probe_at`);
    }
    expect(await sessionCount()).toBe(chats);
  });
});

describe('the chats-at-once limit', () => {
  function send(sessionId: string, anthropicSessionId: string, opening?: boolean) {
    return withRequestContext({ route: 'test/send' }, () =>
      sendSessionMessage({
        sessionId,
        sendId: randomUUID(),
        text: 'hello',
        opening,
        dispatchPendingToolCalls: async () => {},
        caller: writeGrantForTest({
          sessionRowId: sessionId,
          workspaceId,
          organizationId: 'org',
          userId: 'owner',
          anthropicSessionId,
          permissionMode: 'auto',
        }),
      }),
    );
  }
  async function fillChatSlots(count: number) {
    for (let index = 0; index < count; index += 1) await seedChat('running');
  }

  test.each([
    ['the opening of a waiting chat', 'awaiting_opening', true],
    ['a new turn in an idle chat', 'idle', undefined],
  ] as const)('a full workspace refuses %s without posting it', async (_case, status, opening) => {
    const chat = await seedChat(status, 'sesn_waiting');
    await fillChatSlots(PLANS.pro.limits.chatsAtOnce);
    await expect(send(chat, 'sesn_waiting', opening)).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
    });
    expect(fakes.send).not.toHaveBeenCalled();
    expect(await statusOf(chat)).toBe(status);
  });

  test('openings racing for the last slots start exactly limit-many chats', async () => {
    const chats = [];
    for (let index = 0; index <= PLANS.pro.limits.chatsAtOnce; index += 1)
      chats.push({
        id: await seedChat('awaiting_opening', `sesn_${index}`),
        anthropic: `sesn_${index}`,
      });
    const outcomes = await Promise.allSettled(
      chats.map((chat) => send(chat.id, chat.anthropic, true)),
    );
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(
      PLANS.pro.limits.chatsAtOnce,
    );
    expect(fakes.send).toHaveBeenCalledTimes(PLANS.pro.limits.chatsAtOnce);
  });

  test('a message into a chat that is already running is never refused by the limit', async () => {
    const running = await seedChat('running', 'sesn_running');
    await fillChatSlots(PLANS.pro.limits.chatsAtOnce - 1);
    expect(await send(running, 'sesn_running')).toEqual({ eventId: 'echo', processedAt: null });
  });
});

describe('turn analytics', () => {
  const turn = {
    startedAt: 1000,
    firstTokenAt: 1800,
    endedAt: 4000,
    replies: 1,
    modelRequests: 2,
    interrupted: false,
    terminated: false,
    startEstimated: false,
  };
  let sessionId: string;
  beforeEach(async () => {
    sessionId = await seedChat('running', 'sesn_turn');
  });
  const spend = (credits: number, at: string | ReturnType<typeof sql>) =>
    db.execute(sql`insert into usage_event (workspace_id, session_id, event_type, credits_delta, created_at)
      values (${workspaceId}, ${sessionId}, 'model_request', ${-credits}, ${at})`);

  test('two relays finishing the same turn report it and its spend once', async () => {
    await spend(3, new Date(2000).toISOString());
    const input = { anthropicSessionId: 'sesn_turn', terminalEventId: 'terminal_once', turn };
    expect(
      (await Promise.all([captureCompletedTurn(input), captureCompletedTurn(input)])).sort(),
    ).toEqual(['captured', 'replay']);
    const identity = { userId: 'owner', workspaceId };
    expect(fakes.capture.mock.calls).toEqual([
      [
        'session:turn_complete',
        expect.objectContaining({ ttft_ms: 800, duration_ms: 3000, is_error: false }),
        identity,
      ],
      [
        'billing:credit_spend',
        expect.objectContaining({ credits: 3, usage_kind: 'turn' }),
        identity,
      ],
    ]);
  });

  test('a turn for an unknown session is never reported', async () => {
    expect(
      await captureCompletedTurn({
        anthropicSessionId: 'missing',
        terminalEventId: 'terminal_missing',
        turn,
      }),
    ).toBe('unknown-session');
    expect(fakes.capture).not.toHaveBeenCalled();
  });

  test("a turn's spend counts only rows after the previous turn, and claims stay out of webhook receipts", async () => {
    await spend(3, sql`now() - interval '1 minute'`);
    const now = Date.now();
    const first = {
      anthropicSessionId: 'sesn_turn',
      terminalEventId: 'terminal_first',
      turn: { ...turn, endedAt: now },
    };
    expect(await captureCompletedTurn(first)).toBe('captured');
    await spend(2, sql`now() + interval '1 second'`);
    fakes.capture.mockReset();
    const second = {
      ...first,
      terminalEventId: 'terminal_second',
      turn: { ...turn, endedAt: now + 60_000 },
    };
    expect(await captureCompletedTurn(second)).toBe('captured');
    expect(fakes.capture).toHaveBeenCalledWith(
      'billing:credit_spend',
      expect.objectContaining({ credits: 2 }),
      {
        userId: 'owner',
        workspaceId,
      },
    );
    const receipts = await db.execute(
      sql`select count(*)::int as count from processed_webhook_event`,
    );
    expect(receipts.rows).toEqual([{ count: 0 }]);
  });
});
