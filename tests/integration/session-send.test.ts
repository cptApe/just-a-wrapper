/** Sending a chat message: each send reaches the agent exactly once through retries, leases and the route; real Postgres, Anthropic faked. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { fundAllWorkspaces } from './helpers/billing-ledger';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { seedChatSession } from './helpers/seed-chat-session';
import { writeGrantForTest } from './helpers/session-grant';
import { makeTestDb, makeTestPool } from './helpers/test-db';

/** A provider event page, read either as `.data` or by async iteration. */
function page(events: unknown[]) {
  return {
    data: events,
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
  };
}
const fakes = vi.hoisted(() => ({
  send: vi.fn(),
  list: vi.fn(),
  grounding: Promise.resolve(),
  after: [] as Array<() => unknown>,
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/server', async (actual) => ({
  ...(await actual<typeof import('next/server')>()),
  after: (job: () => unknown) => fakes.after.push(job),
}));
vi.mock('@/lib/auth', async () =>
  (await import('./helpers/seams')).signedInAs(() => ({ userId: 'owner', organizationId: 'org' })),
);
vi.mock('@/lib/observability', () => ({
  captureException: vi.fn(),
  flushObservability: vi.fn(async () => undefined),
  initPostHog: () => undefined,
}));
vi.mock('@/lib/analytics', () => ({ captureEvent() {} }));
vi.mock('@/features/agents', async (original) => {
  const client = () => ({ beta: { sessions: { events: { send: fakes.send, list: fakes.list } } } });
  return {
    ...(await original<typeof import('@/features/agents')>()),
    getAnthropicClient: client,
    requireAnthropicClient: client,
  };
});
// eslint-disable-next-line no-restricted-syntax -- wraps the real grounding read with a gate: the only point to pause a sender between its claim and its provider post, which a database lock cannot do because the retry reads the same rows
vi.mock('@/features/sessions/api/resolve-session-grounding', async (actual) => {
  const real = await actual<typeof import('@/features/sessions/api/resolve-session-grounding')>();
  return {
    ...real,
    resolveSessionSendGrounding: async (
      ...args: Parameters<typeof real.resolveSessionSendGrounding>
    ) => {
      await fakes.grounding;
      return real.resolveSessionSendGrounding(...args);
    },
  };
});

const { withRequestContext } = await import('@/lib/request-context');
const { sendSessionMessage: post } = await import(
  '@/features/session-runtime/api/send-session-message'
);
const { claimSessionSend, finishSessionSend, sweepSessionSends, SESSION_SEND_RETENTION_MS } =
  await import('@/features/sessions/api/session-send-transitions');
const { sessionRouteErrorResponse } = await import('@/features/sessions/api/session-access');
const { POST } = await import('@/app/api/sessions/[id]/send/route');
const sendSessionMessage = (request: Parameters<typeof post>[0]) =>
  withRequestContext({ route: 'test/send' }, () => post(request));

const pool = makeTestPool();
const db = makeTestDb(pool);
beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  await seedUser(db, 'owner');
  await seedOrganization(db, 'org');
  await db.execute(sql`insert into workspace (organization_id, name) values ('org', 'Test')`);
  // Every new send passes the spend gate.
  await fundAllWorkspaces(db);
  await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at)
    values ('org-owner', 'org', 'owner', 'owner', now())`);
  fakes.grounding = Promise.resolve();
  fakes.after = [];
  fakes.send.mockReset().mockResolvedValue(echo('echo'));
  // The provider log never shows the message, so recovery concludes it was never sent.
  fakes.list.mockReset().mockImplementation(() => page([]));
});

function echo(id: string) {
  return { data: [{ type: 'user.message', id, processed_at: null }] };
}

function deferred() {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function chat(status: 'idle' | 'awaiting_opening' = 'idle') {
  return seedChatSession(db, 'org', {
    createdByUserId: 'owner',
    workspaceMemoryAccess: 'read_write',
    anthropicSessionId: 'sesn_test',
    status,
  });
}

async function input() {
  const row = await chat();
  return {
    sessionId: row.id,
    sendId: randomUUID(),
    text: 'hello',
    dispatchPendingToolCalls: async () => {},
    caller: writeGrantForTest({
      sessionRowId: row.id,
      workspaceId: row.workspaceId,
      organizationId: 'org',
      userId: 'owner',
      anthropicSessionId: 'sesn_test',
      permissionMode: 'auto',
    }),
  };
}

const sendRows = async () =>
  (await db.execute<{ status: string }>(sql`select status from session_send`)).rows;
const lapseLease = () =>
  db.execute(sql`update session_send set recover_after = now() - interval '1 second'`);

describe('one message per send', () => {
  test.each([
    [529, 'overloaded'],
    [408, 'timeout'],
  ])('after a %s (%s) a retry never reposts until the confirmation window passes, then reposts once', async (status, message) => {
    const request = await input();
    fakes.send.mockRejectedValueOnce(APIError.generate(status, {}, message, new Headers()));
    await expect(sendSessionMessage(request)).rejects.toThrow();
    await expect(sendSessionMessage(request)).rejects.toThrow();
    expect(fakes.send).toHaveBeenCalledTimes(1);
    expect(await sendRows()).toEqual([{ status: 'unconfirmed' }]);
    await lapseLease();
    await Promise.allSettled([sendSessionMessage(request), sendSessionMessage(request)]);
    expect(fakes.send).toHaveBeenCalledTimes(2);
    expect(await sendSessionMessage(request)).toEqual({ eventId: 'echo', processedAt: null });
    expect(fakes.send).toHaveBeenCalledTimes(2);
  });

  test('a retried delivered send returns its echo without posting or charging again', async () => {
    const request = await input();
    expect(await sendSessionMessage(request)).toEqual({ eventId: 'echo', processedAt: null });
    // The retry is not new spend, so the gate never sees it.
    await db.execute(sql`delete from credit_grant`);
    expect(await sendSessionMessage(request)).toEqual({ eventId: 'echo', processedAt: null });
    expect(fakes.send).toHaveBeenCalledOnce();
    // The SDK's own retries would post the message twice.
    expect(fakes.send.mock.calls.at(0)?.at(2)).toEqual({ maxRetries: 0, timeout: 30_000 });
  });

  test('a connection lost after the provider accepted the message finds it in history instead of reposting', async () => {
    const request = await input();
    fakes.send.mockRejectedValue(
      new APIConnectionError({ message: 'connection closed after accept' }),
    );
    let failure: unknown;
    await assert.rejects(sendSessionMessage(request), (error) => {
      failure = error;
      return true;
    });
    expect((await sessionRouteErrorResponse(failure).json()).error.code).toBe(
      'EXTERNAL_API_FAILED',
    );
    fakes.list.mockImplementation(() =>
      page([
        {
          type: 'user.message',
          id: 'recovered',
          processed_at: null,
          content: [{ type: 'text', text: `hello\n<client_send_id id="${request.sendId}"/>` }],
        },
      ]),
    );
    expect(await sendSessionMessage(request)).toEqual({ eventId: 'recovered', processedAt: null });
    expect(await sendSessionMessage(request)).toEqual({ eventId: 'recovered', processedAt: null });
    expect(fakes.send).toHaveBeenCalledOnce();
  });

  test('a failed context read before posting waits for confirmation instead of failing the send', async () => {
    const request = await input();
    await db.execute(sql`alter table "user" rename column timezone to unavailable_timezone`);
    try {
      await expect(sendSessionMessage(request)).rejects.toThrow();
    } finally {
      await db.execute(sql`alter table "user" rename column unavailable_timezone to timezone`);
    }
    expect(fakes.send).not.toHaveBeenCalled();
    expect(await sendRows()).toEqual([{ status: 'unconfirmed' }]);
    await lapseLease();
    await sendSessionMessage(request);
    expect(fakes.send).toHaveBeenCalledOnce();
  });

  test('an opening the provider accepted is not sent again when the local status write fails', async () => {
    const request = { ...(await input()), opening: true };
    await db.execute(sql`update session set status = 'awaiting_opening'`);
    fakes.send.mockImplementationOnce(async () => {
      await db.execute(
        sql`alter table session add constraint test_reject_running check (status <> 'running')`,
      );
      return echo('accepted');
    });
    try {
      await expect(sendSessionMessage(request)).rejects.toThrow();
      await expect(sendSessionMessage(request)).rejects.toThrow();
      expect(fakes.send).toHaveBeenCalledTimes(1);
      expect(await sendRows()).toEqual([{ status: 'unconfirmed' }]);
    } finally {
      await db.execute(sql`alter table session drop constraint if exists test_reject_running`);
    }
  });

  test('a send into a deleted chat is refused locally and released, never posted', async () => {
    const request = await input();
    await db.execute(sql`update session set hidden_at = now(), status = 'terminated'`);
    await expect(sendSessionMessage(request)).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    await expect(sendSessionMessage(request)).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(fakes.send).not.toHaveBeenCalled();
    expect(await sendRows()).toEqual([{ status: 'error' }]);
  });

  test('duplicate claims of one send id hold one lease, and the id cannot carry different text', async () => {
    const row = await chat();
    const claim = { id: randomUUID(), sessionId: row.id, userId: 'owner', text: 'hello' };
    const claims = await Promise.all([claimSessionSend(claim), claimSessionSend(claim)]);
    expect(claims.map((result) => result.kind).sort()).toEqual(['claimed', 'unconfirmed']);
    const claimed = claims.find((result) => result.kind === 'claimed');
    if (claimed?.kind !== 'claimed') throw new Error('One duplicate must hold the lease');
    const delivered = { eventId: 'sevt_one', processedAt: null };
    expect(await finishSessionSend(claimed.lease, { status: 'delivered', echo: delivered })).toBe(
      true,
    );
    expect(await finishSessionSend(claimed.lease, { status: 'error' })).toBe(false);
    expect(await claimSessionSend(claim)).toEqual({ kind: 'delivered', echo: delivered });
    await expect(claimSessionSend({ ...claim, text: 'another message' })).rejects.toThrow();
  });

  test('old delivered sends are pruned and a kept send stores only a hash of its text', async () => {
    const request = await input();
    await sendSessionMessage(request);
    const expired = new Date(Date.now() - SESSION_SEND_RETENTION_MS - 1000);
    await db.execute(sql`update session_send set updated_at = ${expired}`);
    await claimSessionSend({
      id: randomUUID(),
      sessionId: request.sessionId,
      userId: 'owner',
      text: 'next',
    });
    const rows = (
      await db.execute<{ content_hash: string; status: string }>(
        sql`select content_hash, status from session_send`,
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content_hash).toHaveLength(64);
    expect(rows[0]?.status).toBe('sending');
  });

  test('the sweep closes a send its client abandoned, without posting it', async () => {
    const request = await input();
    await claimSessionSend({
      id: request.sendId,
      sessionId: request.sessionId,
      userId: 'owner',
      text: request.text,
    });
    await lapseLease();
    await sweepSessionSends();
    expect(await sendRows()).toEqual([{ status: 'error' }]);
    expect(fakes.send).not.toHaveBeenCalled();
  });
});

describe('the send lease', () => {
  test('a send slower than a minute is not taken over while its lease holds', async () => {
    const request = await input();
    const landed = deferred();
    fakes.send.mockImplementationOnce(async () => {
      await landed.promise;
      return echo('slow-echo');
    });
    const first = sendSessionMessage(request);
    await vi.waitFor(() => expect(fakes.send).toHaveBeenCalledOnce());
    // More than a minute passes on the row while the provider call is still open.
    await db.execute(sql`update session_send set updated_at = now() - interval '61 seconds'`);
    await sweepSessionSends();
    await expect(sendSessionMessage(request)).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    landed.release();
    expect(await first).toEqual({ eventId: 'slow-echo', processedAt: null });
    expect(await sendSessionMessage(request)).toEqual({ eventId: 'slow-echo', processedAt: null });
    expect(fakes.send).toHaveBeenCalledOnce();
  });

  test('a sender that lost its lease never posts or overwrites, while the sweep and retries post once', async () => {
    const request = await input();
    const stalled = deferred();
    fakes.grounding = stalled.promise;
    const first = sendSessionMessage(request);
    await vi.waitFor(async () => expect(await sendRows()).toEqual([{ status: 'sending' }]));
    await lapseLease();
    fakes.grounding = Promise.resolve();
    const retries = await Promise.allSettled([
      sweepSessionSends(),
      sendSessionMessage(request),
      sendSessionMessage(request),
    ]);
    stalled.release();
    await expect(first).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    expect(fakes.send).toHaveBeenCalledOnce();
    expect(retries.filter((result) => result.status === 'fulfilled').length).toBeGreaterThan(1);
    const rows = await db.execute(sql`select status, event_id from session_send`);
    assert.deepEqual(rows.rows, [{ status: 'delivered', event_id: 'echo' }]);
  });
});

describe('the send route', () => {
  function postToRoute(sessionId: string, body: { text: string; opening?: boolean }) {
    return POST(
      new Request(`http://test/api/sessions/${sessionId}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
  }

  test('an attached file reaches the agent as one message with its sandbox path', async () => {
    const row = await chat('awaiting_opening');
    const text = [
      'Read this',
      '<attached_files>',
      'report.pdf — https://cdn.example/report.pdf',
      'Agent sandbox path for report.pdf: /mnt/session/uploads/report.pdf',
      '</attached_files>',
    ].join('\n');
    expect((await postToRoute(row.id, { text, opening: true })).status).toBe(200);
    expect(fakes.send).toHaveBeenCalledOnce();
    const payload = z
      .object({
        events: z.array(
          z.object({ type: z.string(), content: z.array(z.object({ text: z.string() })) }),
        ),
      })
      .parse(fakes.send.mock.calls[0]?.[1]);
    expect(payload.events.map((event) => event.type)).toEqual(['user.message']);
    expect(payload.events[0]?.content[0]?.text).toContain('/mnt/session/uploads/report.pdf');
  });

  test('a send while a tool waits for approval answers 409 AWAITING_TOOL_RESULT', async () => {
    const row = await chat('awaiting_opening');
    fakes.send.mockRejectedValueOnce(
      APIError.generate(
        400,
        {
          error: {
            type: 'invalid_request_error',
            message: 'waiting on responses to events: user.custom_tool_result',
          },
        },
        undefined,
        new Headers(),
      ),
    );
    const response = await postToRoute(row.id, { text: 'continue', opening: true });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('AWAITING_TOOL_RESULT');
  });

  test('after a send the chat status catches up with the provider log instead of staying running', async () => {
    const row = await chat('awaiting_opening');
    expect((await postToRoute(row.id, { text: 'continue', opening: true })).status).toBe(200);
    expect(fakes.after.length).toBeGreaterThan(0);
    fakes.list.mockImplementation(() =>
      page([
        {
          id: 'idle_1',
          type: 'session.status_idle',
          processed_at: new Date().toISOString(),
          stop_reason: { type: 'end_turn' },
        },
      ]),
    );
    for (const job of fakes.after.splice(0)) await job();
    expect((await db.execute(sql`select status from session`)).rows).toEqual([{ status: 'idle' }]);
  });

  test("the creator's first message opens a waiting chat, and a follow-up sends normally", async () => {
    const row = await chat('awaiting_opening');
    expect((await postToRoute(row.id, { text: 'Continue' })).status).toBe(200);
    expect((await db.execute(sql`select status from session`)).rows).toEqual([
      { status: 'running' },
    ]);
    expect((await postToRoute(row.id, { text: 'Continue' })).status).toBe(200);
    expect(fakes.send).toHaveBeenCalledTimes(2);
  });
});
