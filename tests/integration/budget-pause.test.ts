// A session pauses once when its credits or its member allowance run out, and resumes only when it may spend.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { seedCreditBalance } from './helpers/billing-ledger';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { writeGrantForTest } from './helpers/session-grant';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const provider = vi.hoisted(() => ({
  send: vi.fn(),
  list: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
  deploymentRetrieve: vi.fn(),
}));
vi.mock('next/server', () => ({ after: () => {} }));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('@/lib/observability', async (original) => ({
  ...(await original<typeof import('@/lib/observability')>()),
  captureException: vi.fn(),
}));
vi.mock('@/features/agents/api/anthropic-client', () => {
  const client = () => ({
    beta: {
      sessions: {
        retrieve: provider.retrieve,
        update: provider.update,
        events: { send: provider.send, list: provider.list },
      },
      deployments: { retrieve: provider.deploymentRetrieve },
      files: { list: () => ({ async *[Symbol.asyncIterator]() {} }) },
    },
  });
  return { getAnthropicClient: client, requireAnthropicClient: client };
});

const { accrueModelRequest } = await import('@/features/billing/api/accrue-model-request');
const { accrueSessionEnd } = await import('@/features/billing/api/accrue-session-end');
const { claimSessionResume } = await import('@/features/billing/api/claim-session-resume');
const { pauseSessionForBudgetReached } = await import(
  '@/features/billing/api/pause-session-on-exhaustion'
);
const { resumePausedSessions, resumeSessionExplicitly } = await import(
  '@/features/billing/api/resume-paused-sessions'
);
const { syncSessionStatus } = await import('@/features/sessions/api/sync-session-status');
const { adoptTaskRunBySessionId } = await import('@/features/tasks/api/adopt-task-run');
const { withRequestContext } = await import('@/lib/request-context');

const pool = makeTestPool();
const db = makeTestDb(pool);
const ORG = 'org_budget_pause';
const USER = 'user_budget_pause';
const USAGE_120_CREDITS = {
  inputTokens: 100_000,
  outputTokens: 100_000,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};
const INTERRUPT = { events: [{ type: 'user.interrupt' }] };

let workspaceId: string;

beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  provider.send.mockReset().mockResolvedValue(undefined);
  provider.list.mockReset().mockResolvedValue([]);
  provider.retrieve.mockReset().mockResolvedValue({ usage: { active_seconds: 0 } });
  provider.update.mockReset().mockResolvedValue({});
  provider.deploymentRetrieve
    .mockReset()
    .mockResolvedValue({ status: 'active', archived_at: null, schedule: null });
  await seedOrganization(db, ORG);
  await seedUser(db, USER);
  await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at)
    values ('budget-pause-owner', ${ORG}, ${USER}, 'owner', now())`);
  workspaceId = randomUUID();
  await db.execute(sql`insert into workspace (id, organization_id, name)
    values (${workspaceId}, ${ORG}, 'Budget pause')`);
});

const inContext = <T>(run: () => Promise<T>) => withRequestContext({ route: 'test/pause' }, run);

// A Pro workspace runs three chats at once and may give members a credit limit.
async function putOnPro() {
  await db.execute(
    sql`update workspace set plan_tier = 'pro', stripe_subscription_id = 'sub_pause', plan_billing_interval = 'month', plan_credits = 1000 where id = ${workspaceId}`,
  );
}

// The member's allowance: `limit` credits this period, `used` of them spent.
async function limitMember(limit: number, used = 0) {
  await db.execute(sql`insert into workspace_member (organization_id, user_id, composio_user_id, credit_limit)
    values (${ORG}, ${USER}, 'budget-pause-member', ${limit})`);
  if (used > 0)
    await db.execute(sql`insert into usage_event (workspace_id, user_id, event_type, credits_delta)
      values (${workspaceId}, ${USER}, 'model_request', ${-used})`);
}

async function seedSession(
  anthropicSessionId: string,
  opts: { status?: string; pausedReason?: 'credits' | 'budget' } = {},
): Promise<string> {
  const id = randomUUID();
  const paused = opts.status === 'paused_no_credits';
  await db.execute(
    sql`insert into session (workspace_memory_access, id, workspace_id, tier, created_by_user_id, kind, status,
                             anthropic_session_id, paused_reason, paused_at)
        values ('read_write', ${id}, ${workspaceId}, 'default', ${USER}, 'chat', ${opts.status ?? 'running'},
                ${anthropicSessionId}, ${paused ? (opts.pausedReason ?? 'credits') : null},
                ${paused ? sql`now()` : null})`,
  );
  return id;
}

async function pauseState(anthropicSessionId: string) {
  const { rows } = await db.execute<{ status: string; paused_reason: string | null }>(
    sql`select status, paused_reason from session where anthropic_session_id = ${anthropicSessionId}`,
  );
  return requiredRow(rows.at(0));
}

describe('pausing when credits run out', () => {
  test.each([
    {
      charge: 'a model request',
      accrue: (id: string, eventId: string) =>
        accrueModelRequest({
          anthropicSessionId: id,
          anthropicEventId: eventId,
          usage: USAGE_120_CREDITS,
        }),
      balanceAfter: 1 - 120,
    },
    {
      charge: 'an hour of runtime',
      accrue: (id: string, eventId: string) => {
        provider.retrieve.mockResolvedValue({ usage: { active_seconds: 3600 } });
        return accrueSessionEnd(id, { runtime: { kind: 'fetch' }, anthropicEventId: eventId });
      },
      balanceAfter: 1 - 8,
    },
  ])('$charge crossing zero pauses the session and interrupts the agent once', async ({
    accrue,
    balanceAfter,
  }) => {
    await seedCreditBalance(db, workspaceId, 1);
    await seedSession('asess_cross');

    expect(await accrue('asess_cross', 'sevt_cross')).toMatchObject({
      billed: true,
      paused: true,
      balance: balanceAfter,
    });
    expect(await pauseState('asess_cross')).toMatchObject({ status: 'paused_no_credits' });
    expect(provider.send).toHaveBeenCalledWith('asess_cross', INTERRUPT, {
      timeout: 30_000,
      maxRetries: 0,
    });

    // A further charge while already paused never interrupts again.
    await accrueModelRequest({
      anthropicSessionId: 'asess_cross',
      anthropicEventId: 'sevt_cross_again',
      usage: USAGE_120_CREDITS,
    });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  test('two concurrent charges crossing zero both bill but pause and interrupt once', async () => {
    await seedCreditBalance(db, workspaceId, 1);
    await seedSession('asess_race');

    const results = await Promise.all(
      ['sevt_race_a', 'sevt_race_b'].map((anthropicEventId) =>
        accrueModelRequest({
          anthropicSessionId: 'asess_race',
          anthropicEventId,
          usage: USAGE_120_CREDITS,
        }),
      ),
    );

    expect(results.filter((result) => result.billed)).toHaveLength(2);
    expect(results.filter((result) => result.paused)).toHaveLength(1);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(await pauseState('asess_race')).toMatchObject({ status: 'paused_no_credits' });
  });

  test('a redelivered budget_reached webhook records its event and the budget pause once', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    await seedSession('asess_budget');
    const input = { anthropicSessionId: 'asess_budget', webhookEventId: 'evt_budget_once' };

    expect(await pauseSessionForBudgetReached(input)).toBe(true);
    expect(await pauseSessionForBudgetReached(input)).toBe(false);

    expect(await pauseState('asess_budget')).toEqual({
      status: 'paused_no_credits',
      paused_reason: 'budget',
    });
    expect(provider.send).toHaveBeenCalledTimes(1);
    const { rows } = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from processed_webhook_event
          where provider = 'anthropic' and event_id = 'evt_budget_once'`,
    );
    expect(requiredRow(rows.at(0)).count).toBe(1);
  });

  test('a refused interrupt leaves a recoverable pausing session instead of failing the webhook', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    await seedSession('interrupt_failure');
    provider.send.mockRejectedValue(new Error('interrupt refused'));

    await expect(
      pauseSessionForBudgetReached({
        anthropicSessionId: 'interrupt_failure',
        webhookEventId: 'failure',
      }),
    ).resolves.toBe(true);
    expect((await pauseState('interrupt_failure')).status).toBe('pausing');
  });

  test('a status reconcile during a send cannot clear the pause reason', async () => {
    await seedCreditBalance(db, workspaceId, 500);
    await seedSession('asess_keep_pause', { status: 'paused_no_credits', pausedReason: 'budget' });
    provider.list.mockResolvedValue({
      data: [
        { id: 'status_idle', type: 'session.status_idle', stop_reason: { type: 'budget_reached' } },
      ],
    });

    await inContext(() =>
      syncSessionStatus({
        kind: 'reconcile',
        anthropicSessionId: 'asess_keep_pause',
        allowFromPause: false,
      }),
    );

    expect(await pauseState('asess_keep_pause')).toEqual({
      status: 'paused_no_credits',
      paused_reason: 'budget',
    });
  });
});

describe('pausing at the member credit limit', () => {
  test('a charge past a member limit is still billed, pauses for the member limit, and resumes only once the limit is raised', async () => {
    await seedCreditBalance(db, workspaceId, 1000);
    await putOnPro();
    await limitMember(50);
    const sessionRowId = await seedSession('asess_member_limit');

    expect(
      await accrueModelRequest({
        anthropicSessionId: 'asess_member_limit',
        anthropicEventId: 'sevt_member_limit',
        usage: USAGE_120_CREDITS,
      }),
    ).toMatchObject({ billed: true, credits: 120, balance: 880, paused: true });
    expect(await pauseState('asess_member_limit')).toEqual({
      status: 'paused_no_credits',
      paused_reason: 'member_limit',
    });

    const grant = writeGrantForTest({
      workspaceId,
      organizationId: ORG,
      userId: USER,
      anthropicSessionId: 'asess_member_limit',
      sessionRowId,
    });
    await expect(resumeSessionExplicitly(grant)).resolves.toEqual({ resumed: false });
    expect((await pauseState('asess_member_limit')).paused_reason).toBe('member_limit');

    await db.execute(
      sql`update workspace_member set credit_limit = 200 where organization_id = ${ORG} and user_id = ${USER}`,
    );
    expect(
      (await claimSessionResume({ workspaceId, anthropicSessionId: 'asess_member_limit' }))?.status,
    ).toBe('resuming');
  });

  test('adopting a scheduled run whose creator is past their limit pauses it without raising its budget', async () => {
    await seedCreditBalance(db, workspaceId, 1000);
    await putOnPro();
    await limitMember(5, 5);
    const taskId = randomUUID();
    await db.execute(sql`insert into task (id, workspace_id, created_by_user_id, title, description, status, trigger_type, cron_schedule, anthropic_deployment_id)
      values (${taskId}, ${workspaceId}, ${USER}, 'Task', 'Do work', 'upcoming', 'schedule', '0 9 * * *', ${`depl-${taskId}`})`);
    provider.retrieve.mockResolvedValue({
      id: 'limited-run',
      resources: [],
      metadata: { task_id: taskId },
      deployment_id: `depl-${taskId}`,
      status: 'running',
      created_at: new Date().toISOString(),
      usage: { list_cost: { amount: '2', currency: 'USD' } },
      budget: { max_list_cost: { amount: '5000', currency: 'USD' } },
    });

    await inContext(() => adoptTaskRunBySessionId('limited-run'));

    expect(await pauseState('limited-run')).toEqual({
      status: 'paused_no_credits',
      paused_reason: 'member_limit',
    });
    expect(provider.send).toHaveBeenCalledWith('limited-run', INTERRUPT, expect.anything());
    expect(provider.update).not.toHaveBeenCalled();
  });
});

describe('resuming a paused session', () => {
  async function seedChat(status: string, anthropicSessionId: string) {
    const paused = status === 'paused_no_credits';
    await db.execute(sql`insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, status, anthropic_session_id, paused_reason, paused_at)
      values ('none', ${workspaceId}, 'default', ${USER}, 'chat', ${status}, ${anthropicSessionId},
        ${paused ? 'credits' : null}, ${paused ? sql`now()` : null})`);
  }
  const resume = () => claimSessionResume({ workspaceId, anthropicSessionId: 'paused_chat' });

  test('an automatic resume never wakes a session while the balance is not positive', async () => {
    await seedSession('empty-resume', { status: 'paused_no_credits' });
    expect(await resumePausedSessions(workspaceId, { budgetRaisedSessionIds: [] })).toEqual([]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  test('a resume needs a free chats-at-once slot; a retrying chat holds one', async () => {
    await seedCreditBalance(db, workspaceId, 1000);
    await putOnPro();
    await seedChat('running', 'busy_1');
    await seedChat('rescheduling', 'busy_2');
    await seedChat('requires_input', 'waiting');
    await seedChat('paused_no_credits', 'paused_chat');
    await expect(resume()).resolves.toMatchObject({ status: 'resuming' });

    await db.execute(sql`update session set status = 'paused_no_credits', paused_reason = 'credits', paused_at = now()
      where anthropic_session_id = 'paused_chat'`);
    await seedChat('running', 'busy_3');
    await expect(resume()).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    expect((await pauseState('paused_chat')).status).toBe('paused_no_credits');
  });

  test("the creator's spend gate refuses a resume at an empty balance or at the member limit", async () => {
    await putOnPro();
    await seedChat('paused_no_credits', 'paused_chat');
    await expect(resume()).resolves.toBeNull();

    await seedCreditBalance(db, workspaceId, 100);
    await limitMember(10, 10);
    await expect(resume()).resolves.toBeNull();
    expect((await pauseState('paused_chat')).status).toBe('paused_no_credits');
  });
});
