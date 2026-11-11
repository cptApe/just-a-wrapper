/** The app shell and Home keep working when parts fail, and the workspace recoveries they schedule finish; real Postgres. */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const request = vi.hoisted(() => ({
  viewer: {
    userId: 'shell-user',
    name: 'User',
    email: 'shell@example.test',
    organizationId: 'shell-org',
    sessionId: 'shell-session',
  },
  // The active workspace lives on the auth session row, so a workspace switch is seen by later reads.
  activeOrganization: async (): Promise<string | null> => null,
  jobs: [] as Array<() => unknown>,
}));
vi.mock('@/lib/auth', async () =>
  (await import('./helpers/seams')).signedInAs(async () => ({
    ...request.viewer,
    organizationId: (await request.activeOrganization()) ?? request.viewer.organizationId,
  })),
);
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('next/server', () => ({ after: (job: () => unknown) => request.jobs.push(job) }));
vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, {
    COMPOSIO_API_KEY: 'test-composio-key',
    MCP_PROXY_URL: 'https://proxy.example.test/api/mcp/composio',
    MCP_PROXY_JWT_SECRET: 'proxy-secret',
  }),
);

const { default: AppGroupLayout } = await import('@/app/app/(shell)/layout');
const { currentMember } = await import('@/features/integrations/api/connection-context');
const { recoverConnectionDisconnects } = await import(
  '@/features/integrations/api/recover-connection-disconnects'
);
const { loadShellGate } = await import('@/features/shell/api/load-shell-gate');
const { loadSidebar } = await import('@/features/shell/api/load-sidebar');
const { ShellRecovery } = await import('@/features/shell/components/shell-recovery');
const { loadHomePage } = await import('@/features/chat/api/load-home-page');
const { listUserWorkspaces } = await import('@/features/workspaces/api/members');
const { deleteWorkspace } = await import('@/features/workspaces/api/danger-actions');
const { withRequestContext } = await import('@/lib/request-context');

const pool = makeTestPool();
const database = makeTestDb(pool);
beforeAll(() => applyMigrations(database));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(database);
  request.jobs = [];
  request.activeOrganization = async () => {
    const { rows } = await database.execute<{ active_organization_id: string | null }>(
      sql`select active_organization_id from auth_session where id = 'shell-session'`,
    );
    return rows[0]?.active_organization_id ?? null;
  };
  await seedUser(database, 'shell-user');
  await seedOrganization(database, 'shell-org');
  await database.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values ('shell-member', 'shell-org', 'shell-user', 'owner', now())`,
  );
  await database.execute(
    sql`insert into workspace (organization_id, name) values ('shell-org', 'Shell')`,
  );
  await database.execute(
    sql`insert into workspace_member (organization_id, user_id, composio_user_id) values ('shell-org', 'shell-user', 'shell-composio')`,
  );
});

async function seedSecondWorkspace(organizationId: string, name: string, role: 'owner' | 'member') {
  await seedOrganization(database, organizationId);
  await database.execute(
    sql`insert into workspace (organization_id, name) values (${organizationId}, ${name})`,
  );
  await database.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values (${`${organizationId}-member`}, ${organizationId}, 'shell-user', ${role}, now())`,
  );
}

const shellGate = () =>
  withRequestContext({ route: 'test-shell' }, () => loadShellGate(new Headers()));

const fetchStub = () =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ items: [], next_cursor: null }));

test('the app opens on existing rows while provider provisioning is pending, and schedules the repair', async () => {
  expect((await shellGate()).kind).toBe('ready');
  expect(request.jobs.length).toBeGreaterThan(0);
  const rows = await database.execute(sql`select provisioning_status from workspace_member`);
  expect(rows.rows).toEqual([{ provisioning_status: 'pending' }]);
});

test('a new personal workspace finishes provisioning before the app opens', async () => {
  await database.execute(sql`delete from organization`);
  await database.execute(
    sql`insert into auth_session (id, expires_at, token, updated_at, user_id, active_organization_id) values ('shell-session', now() + interval '1 day', 'shell-token', now(), 'shell-user', 'shell-org')`,
  );
  expect((await shellGate()).kind).toBe('ready');
  expect(
    (await database.execute(sql`select provisioning_status from workspace_member`)).rows,
  ).toEqual([{ provisioning_status: 'ready' }]);
  expect(request.jobs).toHaveLength(0);
});

test('a failed shell gate still offers the other live workspaces to switch to', async () => {
  await seedSecondWorkspace('recovery-org', 'Recovery', 'member');
  // A broken workspace membership read fails the gate without breaking workspace discovery.
  await database.execute(
    sql`alter table workspace_member rename column user_id to unavailable_user_id`,
  );
  try {
    const gate = await shellGate();
    if (gate.kind !== 'failed') throw new Error('Expected recovery gate');
    expect(gate.workspaces).toContainEqual({
      organizationId: 'recovery-org',
      name: 'Recovery',
      role: 'member',
      isActive: false,
    });
  } finally {
    await database.execute(
      sql`alter table workspace_member rename column unavailable_user_id to user_id`,
    );
  }
});

test('a failed chat history read keeps the workspace switcher and the page content', async () => {
  const workspaces = [{ organizationId: 'shell-org', name: 'Shell', isActive: true }];
  await database.execute(sql`alter table session rename to session_unavailable`);
  try {
    const sidebar = await withRequestContext({ route: 'test-sidebar' }, () =>
      loadSidebar({ organizationId: 'shell-org', userId: 'shell-user', workspaces }),
    );
    expect(sidebar).toEqual({ workspaces, sessions: [], sessionsCursor: null });
    const rendered = await AppGroupLayout({ children: 'Workspace content' });
    expect(rendered.type).not.toBe(ShellRecovery);
  } finally {
    await database.execute(sql`alter table session_unavailable rename to session`);
  }
});

test('Home moves to a remaining workspace when the active one was deleted', async () => {
  await seedSecondWorkspace('other-org', 'Other', 'owner');
  await database.execute(
    sql`insert into auth_session (id, expires_at, token, updated_at, user_id, active_organization_id) values ('shell-session', now() + interval '1 day', 'shell-token', now(), 'shell-user', 'shell-org')`,
  );
  await database.execute(
    sql`update workspace set deleted_at = now(), lifecycle_status = 'deleted' where organization_id = 'shell-org'`,
  );
  const home = await loadHomePage();
  if (home.kind !== 'ready') throw new Error('Expected the remaining workspace');
  expect(home.organizationId).toBe('other-org');
  const workspaces = await listUserWorkspaces({
    userId: 'shell-user',
    currentOrganizationId: 'other-org',
  });
  expect(workspaces.map((row) => row.organizationId)).toEqual(['other-org']);
});

test('Home fails loudly instead of rendering empty when the workspace read fails', async () => {
  await database.execute(sql`alter table workspace rename to unavailable_workspace`);
  try {
    await expect(loadHomePage()).rejects.toThrow();
  } finally {
    await database.execute(sql`alter table unavailable_workspace rename to workspace`);
  }
});

test('a disconnect in progress does not block reading who the member is', async () => {
  await database.execute(
    sql`insert into integration (workspace_id, user_id, toolkit, status) select id, 'shell-user', 'gmail', 'disconnecting' from workspace`,
  );
  await expect(currentMember()).resolves.toMatchObject({ composioUserId: 'shell-composio' });
});

test('the disconnect sweep finishes expired disconnects and leaves live ones alone', async () => {
  await database.execute(
    sql`insert into integration (workspace_id, user_id, toolkit, status, observed_at) select id, 'shell-user', 'gmail', 'disconnecting', now() - interval '6 minutes' from workspace`,
  );
  await database.execute(
    sql`insert into integration (workspace_id, user_id, toolkit, status) select id, 'shell-user', 'slack', 'disconnecting' from workspace`,
  );
  const network = fetchStub();
  try {
    expect(await recoverConnectionDisconnects()).toEqual({ completed: 1, failed: 0 });
    expect(
      (await database.execute(sql`select toolkit, status from integration order by toolkit`)).rows,
    ).toEqual([
      { toolkit: 'gmail', status: 'disconnected' },
      { toolkit: 'slack', status: 'disconnecting' },
    ]);
  } finally {
    network.mockRestore();
  }
});

test("a deleted workspace's disconnects cannot crowd a live workspace out of the sweep", async () => {
  await seedOrganization(database, 'deleted-org');
  await database.execute(
    sql`insert into workspace (organization_id, name, lifecycle_status, deleted_at) values ('deleted-org', 'Deleted', 'deleted', now())`,
  );
  await database.execute(
    sql`insert into workspace_member (organization_id, user_id, composio_user_id) values ('deleted-org', 'shell-user', 'deleted-member')`,
  );
  await database.execute(
    sql`insert into integration (workspace_id, user_id, toolkit, status, observed_at) select id, 'shell-user', 'deleted-' || n, 'disconnecting', now() - interval '1 day' from workspace cross join generate_series(1, 50) n where organization_id = 'deleted-org'`,
  );
  await database.execute(
    sql`insert into integration (workspace_id, user_id, toolkit, status, observed_at) select id, 'shell-user', 'gmail', 'disconnecting', now() - interval '6 minutes' from workspace where organization_id = 'shell-org'`,
  );
  const network = fetchStub();
  try {
    expect(await recoverConnectionDisconnects()).toEqual({ completed: 1, failed: 0 });
    expect(network).toHaveBeenCalledTimes(1);
  } finally {
    network.mockRestore();
  }
});

test('deleting a workspace returns before provider cleanup, which then finishes the delete', async () => {
  await seedSecondWorkspace('other-org', 'Other', 'owner');
  const target = (
    await database.execute<{ id: string }>(
      sql`select id from workspace where organization_id = 'shell-org'`,
    )
  ).rows.at(0);
  if (!target) throw new Error('Missing shell workspace');
  const lifecycle = async () =>
    (await database.execute(sql`select lifecycle_status from workspace where id = ${target.id}`))
      .rows;
  expect(await deleteWorkspace({ workspaceId: target.id, confirmName: 'Shell' })).toMatchObject({
    ok: true,
    data: 'DELETED',
  });
  expect(await lifecycle()).toEqual([{ lifecycle_status: 'deleting' }]);
  expect(request.jobs).toHaveLength(1);
  for (const job of request.jobs) await job();
  expect(await lifecycle()).toEqual([{ lifecycle_status: 'deleted' }]);
});

test('deleting from a stale page asks for a reload and deletes nothing', async () => {
  expect(
    await deleteWorkspace({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      confirmName: 'Shell',
    }),
  ).toMatchObject({ ok: false, code: 'WORKSPACE_CHANGED' });
  expect((await database.execute(sql`select lifecycle_status from workspace`)).rows).toEqual([
    { lifecycle_status: 'live' },
  ]);
  expect(request.jobs).toHaveLength(0);
});
