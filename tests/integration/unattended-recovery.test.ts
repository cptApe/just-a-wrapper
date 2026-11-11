/** Work that finishes with no browser open: tool dispatch, approvals, member removal and the recovery cron; real Postgres, provider HTTP faked. */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { fundAllWorkspaces } from './helpers/billing-ledger';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-recovery-key';
  process.env.ANTHROPIC_AGENT_ID_DEFAULT = 'agent_test';
  process.env.ANTHROPIC_ENVIRONMENT_ID = 'env_test';
  process.env.CRON_SECRET = 'test-recovery-cron';
});
vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, { COMPOSIO_API_KEY: undefined }),
);
const { dispatchSessionActions } = await import('@/features/tools/api/dispatch-session-actions');
const { revokeMemberWorkspaceAccess } = await import(
  '@/features/workspaces/api/revoke-member-workspace-access'
);
const { drainMemberCleanups } = await import('@/features/integrations/api/member-cleanup');
const { withRequestContext } = await import('@/lib/request-context');
const { GET } = await import('@/app/api/cron/recovery/route');
const pool = makeTestPool();
const db = makeTestDb(pool);
let workspaceId: string;
let sessionId: string;
let failSend = false;
let beforeEventRead: ((types: string[]) => void) | null = null;
let activeIds: string[];
let holdSend: (() => Promise<void>) | null;
let posted: Array<Record<string, unknown>>;
let pending: Array<Record<string, unknown>>;
beforeAll(() => applyMigrations(db));
afterAll(() => {
  vi.restoreAllMocks();
  return pool.end();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await truncateAll(db);
  await seedOrganization(db, 'org');
  await seedUser(db, 'owner');
  workspaceId = randomUUID();
  sessionId = randomUUID();
  await db.execute(
    sql`insert into workspace(id,organization_id,name) values(${workspaceId},'org','Recovery')`,
  );
  // Every new chat and send passes the spend gate.
  await fundAllWorkspaces(db);
  await db.execute(
    sql`insert into member(id,organization_id,user_id,role,created_at) values('membership','org','owner','owner',now())`,
  );
  await db.execute(sql`insert into session(workspace_memory_access, id,workspace_id,created_by_user_id,tier,anthropic_session_id,status,permission_mode,kind)
    values('read_write', ${sessionId},${workspaceId},'owner','default','sesn_recovery','requires_input','auto','chat')`);
  failSend = false;
  beforeEventRead = null;
  activeIds = ['tool_list'];
  holdSend = null;
  posted = [];
  pending = [{ id: 'tool_list', type: 'agent.custom_tool_use', name: 'list_skills', input: {} }];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/vaults')
      return Response.json({ data: [], has_more: false, next_page: null });
    if (url.pathname === '/v1/sessions' && request.method === 'POST')
      return Response.json({ id: 'new_session' });
    if (url.pathname.endsWith('/events') && request.method === 'GET') {
      const types = url.searchParams.getAll('types[]').concat(url.searchParams.getAll('types'));
      beforeEventRead?.(types);
      const events = [
        {
          id: 'idle_current',
          type: 'session.status_idle',
          processed_at: new Date().toISOString(),
          stop_reason: { type: 'requires_action', event_ids: activeIds },
        },
        ...posted.map<Record<string, unknown>>((event, index) => ({
          id: `posted_${index}`,
          ...event,
        })),
        ...pending,
      ].filter((event) => types.length === 0 || types.includes(String(event.type)));
      return Response.json({ data: events, has_more: false, next_page: null });
    }
    if (url.pathname.endsWith('/events') && request.method === 'POST') {
      if (holdSend) await holdSend();
      if (failSend)
        return Response.json(
          { type: 'error', error: { type: 'api_error', message: 'timed out' } },
          { status: 408 },
        );
      const body = await request.json();
      posted.push(...body.events);
      return Response.json({ data: [] });
    }
    throw new Error(`Unexpected request ${request.method} ${url.pathname}`);
  });
});
const dispatch = () =>
  withRequestContext({ route: 'test/unattended' }, () => dispatchSessionActions('sesn_recovery'));

test('a waiting custom tool runs and is answered once with no browser open', async () => {
  await dispatch();
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    type: 'user.custom_tool_result',
    custom_tool_use_id: 'tool_list',
    is_error: false,
  });
  expect((await db.execute(sql`select status from custom_tool_dispatch`)).rows).toEqual([
    { status: 'completed' },
  ]);
  await dispatch();
  expect(posted).toHaveLength(1);
});
test('an auto-mode chat with no browser approves a built-in tool as its creator', async () => {
  activeIds = ['gate'];
  pending = [
    {
      id: 'gate',
      type: 'agent.tool_use',
      name: 'bash',
      input: { command: 'pwd' },
      evaluated_permission: 'ask',
    },
  ];
  await dispatch();
  expect(posted).toContainEqual(
    expect.objectContaining({
      type: 'user.tool_confirmation',
      tool_use_id: 'gate',
      result: 'allow',
    }),
  );
});
test("a removed creator's pending tools never run", async () => {
  await db.execute(sql`delete from member`);
  await dispatch();
  expect(posted).toEqual([]);
});
test('removing a member removes their live scheduled tasks and keeps finished ones', async () => {
  await db.execute(sql`insert into task(workspace_id,created_by_user_id,title,trigger_type,status,cron_schedule)
    values(${workspaceId},'owner','live','schedule','upcoming','0 9 * * *'),(${workspaceId},'owner','finished','schedule','done','0 9 * * *')`);
  await db.transaction((tx) => revokeMemberWorkspaceAccess(tx, 'org', 'owner'));
  expect((await db.execute(sql`select title,status from task order by title`)).rows).toEqual([
    { title: 'finished', status: 'done' },
    { title: 'live', status: 'removed' },
  ]);
});
test('member cleanup keeps a Composio deletion pending while the Composio key is missing', async () => {
  await db.execute(
    sql`insert into integration_cleanup(composio_user_id,requires_composio) values('remote-owner',true)`,
  );
  expect(await drainMemberCleanups({ kind: 'backlog' })).toEqual({ completed: 0, failed: 1 });
  expect((await db.execute(sql`select status from integration_cleanup`)).rows).toEqual([
    { status: 'pending' },
  ]);
});
test('the recovery cron refuses a caller without the cron secret', async () => {
  expect((await GET(new Request('http://localhost/api/cron/recovery'))).status).toBe(401);
});
test('the recovery cron finishes member cleanup with no user traffic', async () => {
  await db.execute(sql`delete from session`);
  // No Anthropic resource needs deletion; an empty vault list proves discovery finished.
  await db.execute(
    sql`insert into integration_cleanup(composio_user_id,requires_composio) values('local-owner',false)`,
  );
  const response = await GET(
    new Request('http://localhost/api/cron/recovery', {
      headers: { authorization: 'Bearer test-recovery-cron' },
    }),
  );
  expect(response.status).toBe(200);
  expect((await db.execute(sql`select * from integration_cleanup`)).rows).toEqual([]);
});

test('an opening send with an unknown outcome stays recoverable instead of being cleaned up', async () => {
  const { startChatSession } = await import('@/features/session-runtime/api/start-chat-session');
  failSend = true;
  await expect(
    withRequestContext({ route: 'test/opening' }, () =>
      startChatSession({
        tier: 'default',
        message: 'Start work',
        workspaceId,
        createdByUserId: 'owner',
        organizationId: 'org',
        permissionMode: 'ask',
        deferInitialMessage: false,
        kind: 'chat',
        dispatchPendingToolCalls: dispatchSessionActions,
      }),
    ),
  ).rejects.toThrow();
  expect(
    (
      await db.execute(
        sql`select status,hidden_at from session where anthropic_session_id='new_session'`,
      )
    ).rows,
  ).toEqual([{ status: 'opening', hidden_at: null }]);
});

test('tool calls abandoned before the latest idle are never run', async () => {
  pending.push({ id: 'old_call', type: 'agent.custom_tool_use', name: 'list_skills', input: {} });
  pending.push({
    id: 'old_gate',
    type: 'agent.tool_use',
    name: 'bash',
    input: {},
    evaluated_permission: 'ask',
  });
  await dispatch();
  expect(posted.map((event) => event.custom_tool_use_id ?? event.tool_use_id)).toEqual([
    'tool_list',
  ]);
});

test('a browser and the server answering the same tool post it once without failing', async () => {
  const { dispatchSessionToolCalls } = await import('@/features/tools/api/dispatch-request');
  let entered: () => void = () => {};
  let release: () => void = () => {};
  const sending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const finish = new Promise<void>((resolve) => {
    release = resolve;
  });
  holdSend = async () => {
    entered();
    await finish;
  };
  const browser = withRequestContext({ route: 'test/browser' }, () =>
    dispatchSessionToolCalls(
      [{ toolUseId: 'tool_list', name: 'list_skills' }],
      {
        anthropicSessionId: 'sesn_recovery',
        sessionRowId: sessionId,
        workspaceId,
        organizationId: 'org',
        userId: 'owner',
        actorUserId: 'owner',
      },
      'skip',
    ),
  );
  await sending;
  try {
    await dispatch();
  } finally {
    release();
    await browser;
  }
  expect(posted).toHaveLength(1);
});

test('an auto-mode run waiting on a tool sends no needs-input notice', async () => {
  await db.execute(
    sql`insert into workspace_member(organization_id,user_id,composio_user_id) values('org','owner','owner-composio')`,
  );
  const taskId = randomUUID();
  await db.execute(
    sql`insert into task(id,workspace_id,created_by_user_id,title,trigger_type,status,notification,cron_schedule) values(${taskId},${workspaceId},'owner','Task','schedule','upcoming','app','0 9 * * *')`,
  );
  await db.execute(
    sql`update session set kind='task_run', task_id=${taskId} where id=${sessionId}`,
  );
  const { syncSessionStatus } = await import('@/features/sessions/api/sync-session-status');
  await withRequestContext({ route: 'test/status' }, () =>
    syncSessionStatus({
      kind: 'reconcile',
      anthropicSessionId: 'sesn_recovery',
      allowFromPause: false,
    }),
  );
  expect((await db.execute(sql`select * from notification`)).rows).toHaveLength(0);
});

test('a scheduled run waiting on an approval notifies its creator once', async () => {
  await db.execute(
    sql`insert into workspace_member(organization_id,user_id,composio_user_id) values('org','owner','owner-composio')`,
  );
  const taskId = randomUUID();
  await db.execute(
    sql`insert into task(id,workspace_id,created_by_user_id,title,trigger_type,status,notification,cron_schedule) values(${taskId},${workspaceId},'owner','Task','schedule','upcoming','app','0 9 * * *')`,
  );
  await db.execute(
    sql`update session set kind='task_run', task_id=${taskId}, permission_mode='ask' where id=${sessionId}`,
  );
  activeIds = ['gate'];
  pending = [
    {
      id: 'gate',
      type: 'agent.tool_use',
      name: 'bash',
      input: { command: 'pwd' },
      evaluated_permission: 'ask',
    },
  ];
  await dispatch();
  await dispatch();
  expect(posted).toEqual([]);
  expect((await db.execute(sql`select * from notification`)).rows).toHaveLength(1);
});

test('a failing member cleanup counts as a durable failure, so the sweep cooldown holds', async () => {
  const { runRecoverySweeps } = await import('@/features/jobs/api/recovery-sweeps');
  const { DurableRecoveryError } = await import('@/lib/recover-rows');
  await db.execute(sql`delete from session`);
  await db.execute(
    sql`insert into integration_cleanup(composio_user_id,requires_composio) values('retained',true)`,
  );
  await expect(
    withRequestContext({ route: 'test/durable-sweep' }, runRecoverySweeps),
  ).rejects.toBeInstanceOf(DurableRecoveryError);
});

test.each([
  ['a live', 'requires_input', 'terminated', true],
  ['an idle', 'idle', 'idle', false],
  ['an ended', 'terminated', 'terminated', false],
] as const)('removing the creator of %s scheduled run leaves it %s', async (_case, from, to, hidden) => {
  const endedAt = new Date('2026-01-01T10:00:00.000Z');
  const finished = from !== 'requires_input';
  await db.execute(
    sql`update session set kind='task_run', status=${from}, ended_at=${finished ? endedAt : null} where id=${sessionId}`,
  );
  await db.transaction((tx) => revokeMemberWorkspaceAccess(tx, 'org', 'owner'));
  const row = (
    await db.execute(
      sql`select status, hidden_at is not null as hidden, ended_at = ${endedAt} as same_end from session where id=${sessionId}`,
    )
  ).rows[0];
  expect(row).toMatchObject({ status: to, hidden });
  if (finished) expect(row?.same_end).toBe(true);
  else {
    await dispatch();
    expect(posted).toEqual([]);
  }
});

test('a browser answering one tool mid-batch does not stop the server answering the rest', async () => {
  activeIds = ['tool_list', 'tool_other'];
  pending.push({ id: 'tool_other', type: 'agent.custom_tool_use', name: 'list_skills', input: {} });
  beforeEventRead = (types) => {
    if (types.length !== 2 || !types.includes('user.custom_tool_result')) return;
    beforeEventRead = null;
    posted.push({ type: 'user.custom_tool_result', custom_tool_use_id: 'tool_list', content: [] });
  };
  await dispatch();
  expect(posted.map((event) => event.custom_tool_use_id)).toEqual(['tool_list', 'tool_other']);
  expect((await db.execute(sql`select tool_use_id,status from custom_tool_dispatch`)).rows).toEqual(
    [{ tool_use_id: 'tool_other', status: 'completed' }],
  );
});

test('a custom tool waiting on approval notifies once across replays', async () => {
  await db.execute(
    sql`insert into workspace_member(organization_id,user_id,composio_user_id) values('org','owner','owner-composio')`,
  );
  await db.execute(
    sql`insert into tool_permission(organization_id,user_id,toolkit,tool_name,policy) values('org','owner','builtin','list_skills','ask')`,
  );
  const taskId = randomUUID();
  await db.execute(
    sql`insert into task(id,workspace_id,created_by_user_id,title,trigger_type,status,notification,cron_schedule) values(${taskId},${workspaceId},'owner','Task','schedule','upcoming','app','0 9 * * *')`,
  );
  await db.execute(
    sql`update session set kind='task_run', task_id=${taskId} where id=${sessionId}`,
  );
  await dispatch();
  await dispatch();
  expect(posted).toEqual([]);
  expect((await db.execute(sql`select * from notification`)).rows).toHaveLength(1);
  expect((await db.execute(sql`select status from custom_tool_dispatch`)).rows).toEqual([
    { status: 'awaiting_decision' },
  ]);
});

test('an approval whose delivery failed retries without a needs-input notice', async () => {
  await db.execute(
    sql`insert into workspace_member(organization_id,user_id,composio_user_id) values('org','owner','owner-composio')`,
  );
  const taskId = randomUUID();
  await db.execute(
    sql`insert into task(id,workspace_id,created_by_user_id,title,trigger_type,status,notification,cron_schedule) values(${taskId},${workspaceId},'owner','Task','schedule','upcoming','app','0 9 * * *')`,
  );
  await db.execute(
    sql`update session set kind='task_run', task_id=${taskId} where id=${sessionId}`,
  );
  activeIds = ['gate'];
  pending = [
    {
      id: 'gate',
      type: 'agent.tool_use',
      name: 'bash',
      input: { command: 'pwd' },
      evaluated_permission: 'ask',
    },
  ];
  failSend = true;
  await expect(dispatch()).rejects.toThrow('another recovery attempt');
  expect((await db.execute(sql`select * from notification`)).rows).toHaveLength(0);
  failSend = false;
  await dispatch();
  expect(posted).toHaveLength(1);
});

test('when the browser answered every tool first, no dispatch claim is left behind', async () => {
  beforeEventRead = (types) => {
    if (types.length !== 2 || !types.includes('user.custom_tool_result')) return;
    beforeEventRead = null;
    posted.push({ type: 'user.custom_tool_result', custom_tool_use_id: 'tool_list', content: [] });
  };
  await dispatch();
  expect(posted).toHaveLength(1);
  expect((await db.execute(sql`select * from custom_tool_dispatch`)).rows).toEqual([]);
});

test("a removed creator's approval-waiting tool is answered FORBIDDEN by the sweep", async () => {
  const { prepareCustomToolDispatchGates } = await import('@/features/tools/api/dispatch');
  const { claimAnthropicCustomToolCalls } = await import(
    '@/features/tools/api/tool-delivery-transitions'
  );
  const { recoverRemovedCreatorTools } = await import(
    '@/features/tools/api/recover-removed-creator-tools'
  );
  await db.execute(
    sql`insert into workspace_member (organization_id,user_id,composio_user_id) values ('org','owner','owner')`,
  );
  await db.execute(
    sql`insert into tool_permission (organization_id,user_id,toolkit,tool_name,policy) values ('org','owner','builtin','delete_library_item','ask')`,
  );
  const call = {
    toolUseId: 'removed-park',
    name: 'delete_library_item',
    input: { path: '/Team/test.txt' },
  };
  pending = [
    { id: call.toolUseId, type: 'agent.custom_tool_use', name: call.name, input: call.input },
  ];
  const gates = await prepareCustomToolDispatchGates([call], {
    sessionRowId: sessionId,
    anthropicSessionId: 'sesn_recovery',
    workspaceId,
    organizationId: 'org',
    userId: 'owner',
    actorUserId: 'owner',
  });
  await claimAnthropicCustomToolCalls(sessionId, [call], gates.parkedCalls);
  await db.execute(sql`delete from member`);
  await withRequestContext({ route: 'test/removed-tool-recovery' }, () =>
    recoverRemovedCreatorTools(Date.now() + 60_000),
  );
  expect(posted).toEqual([
    expect.objectContaining({ type: 'user.custom_tool_result', is_error: true }),
  ]);
  expect(JSON.stringify(posted)).toContain('FORBIDDEN');
  expect(
    (
      await db.execute(
        sql`select status from custom_tool_dispatch where tool_use_id = 'removed-park'`,
      )
    ).rows,
  ).toEqual([{ status: 'completed' }]);
});
