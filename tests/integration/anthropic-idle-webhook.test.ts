/** The provider's idle webhook: its follow-up jobs run independently and a failed one asks for a retry; real Postgres, Anthropic faked. */
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

// The upstream session: idle waiting on an action. Its usage read fails, and its file listing
// hangs unless a test lets it finish, so each job meets a different provider answer.
const upstream = vi.hoisted(() => {
  const state = {
    idle: {
      type: 'session.status_idle',
      id: 'sevt_idle',
      processed_at: new Date().toISOString(),
      stop_reason: { type: 'requires_action', event_ids: [] as string[] },
    },
    filesHang: true,
    eventLists: [] as Array<{ limit?: number; types?: string[] }>,
    fileLists: 0,
    client: () => ({
      beta: {
        sessions: {
          events: {
            list: (_sessionId: string, params: { limit?: number; types?: string[] }) => {
              state.eventLists.push(params);
              if (params.types?.includes('span.model_request_end'))
                throw new Error('usage read failed');
              const events = [state.idle];
              // A page the dispatcher reads by `data` and status sync iterates.
              return {
                data: events,
                async *[Symbol.asyncIterator]() {
                  yield* events;
                },
              };
            },
          },
        },
        files: {
          list: () => {
            state.fileLists += 1;
            return {
              async *[Symbol.asyncIterator]() {
                if (state.filesHang) await new Promise(() => {});
              },
            };
          },
        },
      },
    }),
  };
  return state;
});
vi.mock('@/features/agents', async (original) => ({
  ...(await original<typeof import('@/features/agents')>()),
  getAnthropicClient: upstream.client,
  requireAnthropicClient: upstream.client,
}));
vi.mock('@/features/agents/api/anthropic-client', async (original) => ({
  ...(await original<typeof import('@/features/agents/api/anthropic-client')>()),
  getAnthropicClient: upstream.client,
  requireAnthropicClient: upstream.client,
}));

/** Whether the tool dispatcher read the latest status, the first thing it does. */
const dispatched = () => upstream.eventLists.some((params) => params.limit === 1);

const { routeAnthropicEvent } = await import('@/features/webhooks/anthropic-dispatch');
const { withRequestContext } = await import('@/lib/request-context');

const pool = makeTestPool();
const db = makeTestDb(pool);
beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  await seedUser(db, 'owner');
  await seedOrganization(db, 'org');
  // The dispatcher acts as the session's creator, who must still be a member.
  await db.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values ('owner-member', 'org', 'owner', 'owner', now())`,
  );
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into workspace (organization_id, name) values ('org', 'ws') returning id`,
  );
  assert.ok(rows[0]);
  await db.execute(sql`insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, status, anthropic_session_id, last_event_at)
    values ('read_write', ${rows[0].id}, 'default', 'owner', 'task_run', 'running', 'sesn_idle', now() - interval '1 minute')`);
  upstream.filesHang = true;
  upstream.eventLists = [];
  upstream.fileLists = 0;
});

function idled() {
  return {
    id: 'whevt_1',
    created_at: new Date().toISOString(),
    type: 'event' as const,
    data: {
      type: 'session.status_idled',
      id: 'sesn_idle',
      organization_id: 'org_anthropic',
      workspace_id: 'wrkspc_anthropic',
    },
  };
}

test('a failing usage read never stops a waiting tool from running, and the delivery waits for the file sweep', async () => {
  const delivery = withRequestContext({ route: 'test/webhook' }, () =>
    routeAnthropicEvent(idled()),
  );
  await vi.waitFor(() => expect(dispatched()).toBe(true));
  await vi.waitFor(() => expect(upstream.fileLists).toBeGreaterThan(0));
  // The usage read runs beside the file sweep, so it may land after the first listing.
  await vi.waitFor(() =>
    expect(
      upstream.eventLists.filter((params) => params.types?.includes('span.model_request_end')),
    ).toHaveLength(1),
  );
  const { rows } = await db.execute<{ status: string }>(sql`select status from session`);
  expect(rows).toEqual([{ status: 'requires_input' }]);
  // The artifact sweep is still polling; the delivery waits for it before reporting.
  let settled = false;
  void delivery.finally(() => {
    settled = true;
  });
  // Several event-loop turns pass; the hanging file listing still holds the delivery open.
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  expect(settled).toBe(false);
});

test('one failed follow-up job fails the delivery so the provider retries it, naming the job', async () => {
  upstream.filesHang = false;
  await expect(
    withRequestContext({ route: 'test/webhook' }, () => routeAnthropicEvent(idled())),
  ).rejects.toMatchObject({ code: 'UNEXPECTED', context: { failed: ['usage'] } });
  expect(dispatched()).toBe(true);
});
