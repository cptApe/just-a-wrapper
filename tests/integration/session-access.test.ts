/** Who may read, write and act for a chat: the session gates and a shared reader's relay, on real Postgres. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const state = vi.hoisted(() => ({
  viewer: { userId: 'creator', organizationId: 'org_shared' },
  send: vi.fn(),
  history: [] as unknown[],
}));

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/auth', async () => (await import('./helpers/seams')).signedInAs(() => state.viewer));
vi.mock('@/lib/observability', () => ({
  captureException: vi.fn(),
  flushObservability: vi.fn(async () => undefined),
  initPostHog: () => undefined,
}));
vi.mock('@/features/agents', async (original) => {
  const client = {
    beta: {
      sessions: {
        events: {
          stream: async () => ({
            controller: { abort: () => undefined },
            async *[Symbol.asyncIterator]() {},
          }),
          list: () => ({
            data: state.history,
            async *[Symbol.asyncIterator]() {
              yield* state.history;
            },
          }),
          send: state.send,
        },
      },
    },
  };
  return {
    ...(await original<typeof import('@/features/agents')>()),
    getAnthropicClient: () => client,
    requireAnthropicClient: () => client,
  };
});

const {
  authorizeSessionAccess,
  authorizeSessionIdentityWrite,
  authorizeSessionWrite,
  loadWorkspaceSession,
} = await import('@/features/sessions/api/session-access');
const { withRequestContext } = await import('@/lib/request-context');
const { GET: streamRoute } = await import('@/app/api/sessions/[id]/stream/route');

const pool = makeTestPool();
const db = makeTestDb(pool);
beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());

async function seedWorkspace(orgId: string, userIds: string[]): Promise<string> {
  await seedOrganization(db, orgId);
  for (const userId of userIds) {
    await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at)
      values (${randomUUID()}, ${orgId}, ${userId}, 'member', now())`);
  }
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into workspace (organization_id, name) values (${orgId}, ${orgId}) returning id`,
  );
  assert.ok(rows[0]);
  return rows[0].id;
}

async function seedSession(
  workspaceId: string,
  creator: string,
  upstream: string | null,
  visibility: 'private' | 'workspace',
): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, anthropic_session_id, visibility)
        values ('read_write', ${workspaceId}, 'default', ${creator}, 'chat', ${upstream}, ${visibility}) returning id`,
  );
  assert.ok(rows[0]);
  return rows[0].id;
}

function asViewer<T>(userId: string, organizationId: string, gate: () => Promise<T>) {
  state.viewer = { userId, organizationId };
  return withRequestContext({ route: 'test/session-access' }, gate);
}

describe('session gates', () => {
  let shared: string;
  let foreign: string;
  beforeAll(async () => {
    await truncateAll(db);
    for (const user of ['creator', 'other', 'caller', 'foreign']) await seedUser(db, user);
    shared = await seedWorkspace('org_shared', ['creator', 'other']);
    await seedWorkspace('org_caller', ['caller']);
    foreign = await seedWorkspace('org_foreign', ['foreign']);
  });

  test("a workspace cannot load another workspace's session, and an unknown id looks the same", async () => {
    const own = await seedSession(shared, 'creator', 'sess_own', 'private');
    const other = await seedSession(foreign, 'foreign', 'sess_foreign', 'private');
    await expect(
      loadWorkspaceSession({ sessionId: other, workspaceId: shared }),
    ).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
    await expect(
      loadWorkspaceSession({ sessionId: randomUUID(), workspaceId: shared }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(await loadWorkspaceSession({ sessionId: own, workspaceId: shared })).toMatchObject({
      sessionRowId: own,
      anthropicSessionId: 'sess_own',
    });
  });

  // read: open and attach; identity: rename and share; write: send into the conversation.
  const OK = 'ok';
  const NF = 'SESSION_NOT_FOUND';
  const NW = 'SESSION_NOT_WRITABLE';
  test.each([
    { viewer: 'creator', visibility: 'private', upstream: 'up', read: OK, identity: OK, write: OK },
    { viewer: 'creator', visibility: 'private', upstream: null, read: NF, identity: OK, write: NF },
    {
      viewer: 'creator',
      visibility: 'workspace',
      upstream: 'up',
      read: OK,
      identity: OK,
      write: OK,
    },
    {
      viewer: 'creator',
      visibility: 'workspace',
      upstream: null,
      read: NF,
      identity: OK,
      write: NF,
    },
    { viewer: 'other', visibility: 'private', upstream: 'up', read: NF, identity: NF, write: NF },
    { viewer: 'other', visibility: 'private', upstream: null, read: NF, identity: NF, write: NF },
    { viewer: 'other', visibility: 'workspace', upstream: 'up', read: OK, identity: NW, write: NW },
    { viewer: 'other', visibility: 'workspace', upstream: null, read: NF, identity: NW, write: NF },
  ] as const)('$viewer on a $visibility chat (upstream $upstream): read $read, identity $identity, write $write', async (row) => {
    const upstream = row.upstream && `sess_${randomUUID()}`;
    const sessionId = await seedSession(shared, 'creator', upstream, row.visibility);
    const gates = [
      [authorizeSessionAccess, row.read],
      [authorizeSessionIdentityWrite, row.identity],
      [authorizeSessionWrite, row.write],
    ] as const;
    for (const [gate, expected] of gates) {
      const result = asViewer(row.viewer, 'org_shared', () =>
        gate({ sessionId, headers: new Headers() }),
      );
      if (expected === OK) {
        await expect(result).resolves.toMatchObject({
          workspaceId: shared,
          userId: row.viewer,
          sessionRowId: sessionId,
          anthropicSessionId: upstream,
          createdByUserId: 'creator',
        });
      } else if (expected === NW) {
        await expect(result).rejects.toMatchObject({
          code: NW,
          context: { sessionId, userId: row.viewer },
        });
      } else {
        await expect(result).rejects.toMatchObject({
          code: NF,
          context: { sessionId, workspaceId: shared },
        });
      }
    }
  });

  test('a shared chat in another workspace is not found through every gate, without its owner', async () => {
    const sessionId = await seedSession(foreign, 'foreign', 'sess_foreign_shared', 'workspace');
    const { rows } = await db.execute<{ id: string }>(
      sql`select id from workspace where organization_id = 'org_caller'`,
    );
    for (const gate of [
      authorizeSessionAccess,
      authorizeSessionIdentityWrite,
      authorizeSessionWrite,
    ]) {
      await expect(
        asViewer('caller', 'org_caller', () => gate({ sessionId, headers: new Headers() })),
      ).rejects.toMatchObject({
        code: NF,
        context: { sessionId, workspaceId: rows[0]?.id },
      });
    }
  });
});

describe("a shared reader's relay answering the creator's gates", () => {
  const ORG = 'org_gate_actor';
  const SESSION = '00000000-0000-4000-8000-0000000000a1';
  beforeEach(async () => {
    await truncateAll(db);
    state.viewer = { userId: 'reader', organizationId: ORG };
    state.send.mockReset().mockResolvedValue({});
    state.history = [
      {
        id: 'gate_1',
        type: 'agent.tool_use',
        name: 'bash',
        input: { command: 'pwd' },
        evaluated_permission: 'ask',
      },
    ];
    await seedOrganization(db, ORG);
    for (const [userId, role] of [
      ['creator', 'admin'],
      ['reader', 'member'],
    ] as const) {
      await seedUser(db, userId);
      await db.execute(
        sql`insert into member (id, organization_id, user_id, role, created_at) values (${userId}, ${ORG}, ${userId}, ${role}, now())`,
      );
    }
    const { rows } = await db.execute<{ id: string }>(
      sql`insert into workspace (organization_id, name) values (${ORG}, 'Gate actor') returning id`,
    );
    // An auto-mode chat answers unconfigured built-in gates itself, under the creator's standing.
    await db.execute(sql`insert into session (workspace_memory_access, id, workspace_id, tier, created_by_user_id, kind, anthropic_session_id, visibility, permission_mode)
      values ('read_write', ${SESSION}, ${rows[0]?.id}, 'default', 'creator', 'chat', 'sesn_gate_actor', 'workspace', 'auto')`);
  });

  async function confirmationsAfterAttach() {
    const response = await streamRoute(new Request(`http://test/api/sessions/${SESSION}/stream`), {
      params: Promise.resolve({ id: SESSION }),
    });
    expect(response.status).toBe(200);
    await response.text();
    return state.send.mock.calls.flatMap(([, body]) =>
      (body as { events: Array<{ type: string; result?: string }> }).events.filter(
        (event) => event.type === 'user.tool_confirmation',
      ),
    );
  }

  test('the gate is allowed while the creator keeps their standing', async () => {
    expect(await confirmationsAfterAttach()).toEqual([
      expect.objectContaining({ result: 'allow' }),
    ]);
  });

  test.each([
    ['removed', sql`delete from member where user_id = 'creator'`],
    [
      'demoted below read-write memory',
      sql`update member set role = 'member' where user_id = 'creator'`,
    ],
  ])('the gate stays open once the creator is %s', async (_change, statement) => {
    await db.execute(statement);
    expect(await confirmationsAfterAttach()).toEqual([]);
  });
});
