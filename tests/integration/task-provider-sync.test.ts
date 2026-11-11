// Saving a task and keeping its Anthropic deployment in step with the row: create, edit, pause,
// run now and the snapshot sweep. The app row is the truth (decision 0035). Real Postgres and the
// real SDK; only provider HTTP is replaced.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { seedCreditBalance } from './helpers/billing-ledger';
import { fakeDeploymentApi } from './helpers/fake-deployment-api';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-deployment-key';
  process.env.ANTHROPIC_AGENT_ID_DEFAULT = 'agent_test';
  process.env.ANTHROPIC_ENVIRONMENT_ID = 'env_test';
});

const { createTask } = await import('@/features/tasks/api/create-task');
const { updateTask } = await import('@/features/tasks/api/update-task');
const { mirrorDeploymentState, pauseTask, runTaskNow } = await import(
  '@/features/tasks/api/task-lifecycle'
);
const { cancelMemberTasks, writeTaskDefinition } = await import(
  '@/features/tasks/api/task-transitions'
);
const { reconcileTaskState } = await import('@/features/tasks/api/reconcile-task-state');
const { reconcileDeploymentSnapshots } = await import(
  '@/features/tasks/api/reconcile-deployment-snapshots'
);
const { syncCreatorTasks } = await import('@/features/tasks/api/sync-creator-tasks');
const { DurableRecoveryError } = await import('@/lib/recover-rows');
const { db: appDb } = await import('@/db');
const { withRequestContext } = await import('@/lib/request-context');

const pool = makeTestPool();
const db = makeTestDb(pool);
const organizationId = 'org_provider_sync';
const userId = 'user_provider_sync';
let workspaceId: string;
const api = fakeDeploymentApi();
const deploymentWrites = () =>
  api.writes.filter((write) => write.path.startsWith('/v1/deployments'));

beforeAll(() => applyMigrations(db));
beforeEach(async () => {
  vi.restoreAllMocks();
  await truncateAll(db);
  await seedOrganization(db, organizationId);
  await seedUser(db, userId);
  workspaceId = randomUUID();
  await db.execute(sql`insert into workspace (id, organization_id, name, plan_tier, plan_billing_interval, plan_credits, stripe_subscription_id)
    values (${workspaceId}, ${organizationId}, 'Sync tests', 'pro', 'month', 1000, 'sub_sync')`);
  await db.execute(
    sql`insert into member(id,organization_id,user_id,role,created_at) values('owner',${organizationId},${userId},'owner',now())`,
  );
  await seedCreditBalance(db, workspaceId, 1000000);
  api.reset();
  api.install();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await pool.end();
});

const context = <T>(run: () => Promise<T>) => withRequestContext({ route: 'test/sync' }, run);

function scheduleInput(notification: 'off' | 'app' = 'off') {
  return {
    triggerType: 'schedule' as const,
    workspaceId,
    organizationId,
    createdByUserId: userId,
    title: ' Client report ',
    description: ' Summarize messages ',
    tier: 'default' as const,
    autoApprove: true,
    notification,
    successCriteria: 'Include links',
    cron: '0 8 * * *',
    timezone: 'UTC',
  };
}

async function createSchedule(notification: 'off' | 'app' = 'off') {
  return (await context(() => createTask(scheduleInput(notification)))).taskId;
}

const inAnHour = () => {
  const runAt = new Date(Date.now() + 60 * 60_000);
  runAt.setSeconds(0, 0);
  return runAt;
};

async function taskRow(taskId: string) {
  const { rows } = await db.execute<{
    title: string;
    status: string;
    version: number;
    provider_sync: string;
    run_at: string | null;
    run_now_claimed_at: string | null;
  }>(
    sql`select title, status, version, provider_sync, run_at, run_now_claimed_at from task where id = ${taskId}`,
  );
  const row = rows.at(0);
  if (!row) throw new Error('Task missing');
  return row;
}

function edit(taskId: string, expectedVersion: number, title: string, cron = '0 8 * * *') {
  return context(() =>
    updateTask({
      expectedVersion,
      userId,
      taskId,
      workspaceId,
      organizationId,
      title,
      description: ' Summarize messages ',
      cron,
      timezone: 'UTC',
    }),
  );
}

test('an edit sends the same deployment context as create and keeps settings it did not touch', async () => {
  const taskId = await createSchedule();
  await edit(taskId, (await taskRow(taskId)).version, ' Client report ');
  const [created, updated, ...rest] = deploymentWrites();
  expect(rest).toEqual([]);
  expect(created?.path).toBe('/v1/deployments');
  expect(updated?.path).toBe('/v1/deployments/depl_test');
  const { metadata, ...createContext } = created?.body ?? {};
  expect(metadata).toEqual({ task_id: taskId, workspace_id: workspaceId });
  expect(updated?.body).toEqual(createContext);
  const { rows } = await db.execute(
    sql`select tier, auto_approve, notification, provider_sync from task where id = ${taskId}`,
  );
  expect(rows).toEqual([
    { tier: 'default', auto_approve: true, notification: 'off', provider_sync: 'synced' },
  ]);
});

test('two edits of one version: one wins, the other is refused, and the provider matches', async () => {
  const taskId = await createSchedule();
  const { version } = await taskRow(taskId);
  const outcomes = await Promise.allSettled([
    edit(taskId, version, 'From tab A'),
    edit(taskId, version, 'From tab B'),
  ]);
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
    reason: expect.objectContaining({ code: 'CONFLICT' }),
  });
  const row = await taskRow(taskId);
  expect(row.provider_sync).toBe('synced');
  expect(api.state.lastBody.name).toBe(row.title);
});

test('a provider refusal of an edit puts the previous definition back', async () => {
  const taskId = await createSchedule();
  api.state.reject = true;
  await expect(
    edit(taskId, (await taskRow(taskId)).version, 'Refused', '0 9 * * *'),
  ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
  expect(await taskRow(taskId)).toMatchObject({ title: 'Client report', status: 'upcoming' });
});

test('a crash between the row write and the push is finished by the sweep', async () => {
  const taskId = await createSchedule();
  // The request dies after its row write, before it reaches the provider.
  await writeTaskDefinition(appDb, {
    taskId,
    expectedVersion: (await taskRow(taskId)).version,
    definition: { title: 'Saved before the crash' },
    status: 'upcoming',
    sync: 'definition',
  });
  await db.execute(
    sql`update task set updated_at = now() - interval '10 minutes' where id = ${taskId}`,
  );
  await context(reconcileTaskState);
  expect(await taskRow(taskId)).toMatchObject({ provider_sync: 'synced' });
  expect(api.state.lastBody.name).toBe('Saved before the crash');
});

test('a pause during an in-flight edit keeps both and sends no false alert', async () => {
  const taskId = await createSchedule('app');
  const { version } = await taskRow(taskId);
  let release = () => {};
  api.state.updateGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    api.state.onUpdateArrived = resolve;
  });
  const editing = edit(taskId, version, 'Edited while pausing');
  await arrived;
  await context(() => pauseTask({ taskId, workspaceId, userId }));
  api.state.onUpdateArrived = null;
  release();
  await editing;
  expect(await taskRow(taskId)).toMatchObject({
    title: 'Edited while pausing',
    status: 'paused',
    provider_sync: 'synced',
  });
  expect(api.state.status).toBe('paused');
  // The provider echoes the pause the app asked for; it is not news.
  expect(
    await mirrorDeploymentState({ anthropicDeploymentId: 'depl_test', webhookEventId: 'evt_echo' }),
  ).toMatchObject({ handled: false });
  expect((await db.execute(sql`select id from notification`)).rows).toEqual([]);
});

test('a failed grounding read leaves no task and creates no deployment', async () => {
  // Renaming a read-only grounding column produces a real PostgreSQL read error.
  await db.execute(sql`alter table "user" rename column timezone to test_unavailable_timezone`);
  try {
    await expect(context(() => createTask(scheduleInput()))).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '42703' }),
    });
    expect((await db.execute(sql`select id from task`)).rows).toEqual([]);
    expect(deploymentWrites()).toEqual([]);
  } finally {
    await db.execute(sql`alter table "user" rename column test_unavailable_timezone to timezone`);
  }
});

test('a schedule the provider rejects frees its plan slot at once', async () => {
  api.state.reject = true;
  await expect(context(() => createTask(scheduleInput()))).rejects.toMatchObject({
    code: 'TOOL_INPUT_INVALID',
  });
  expect((await db.execute(sql`select status from task`)).rows).toEqual([{ status: 'removed' }]);
});

test('an event task past the plan limit is refused and not saved', async () => {
  for (let index = 0; index < 5; index++)
    await db.execute(sql`insert into task (workspace_id, created_by_user_id, title, status, trigger_type, cron_schedule, next_run_at)
      values (${workspaceId}, ${userId}, ${`Live ${index}`}, 'upcoming', 'schedule', '0 9 * * *', now() + interval '1 day')`);
  await expect(
    context(() =>
      createTask({
        triggerType: 'event',
        workspaceId,
        organizationId,
        createdByUserId: userId,
        title: 'New mail',
        description: 'Reply to it',
        tier: 'default',
        autoApprove: false,
        notification: 'off',
        toolkit: 'gmail',
        eventType: 'GMAIL_NEW_GMAIL_MESSAGE',
      }),
    ),
  ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', context: { scheduled: 5 } });
  expect((await db.execute(sql`select id from task where trigger_type = 'event'`)).rows).toEqual(
    [],
  );
});

test('a one-off whose provider time rolls into next year is removed and archived', async () => {
  await expect(
    context(() => createTask({ ...scheduleInput(), cron: undefined, runAt: inAnHour() })),
  ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
  expect(
    (await db.execute(sql`select status, anthropic_deployment_id, provider_sync from task`)).rows,
  ).toEqual([{ status: 'removed', anthropic_deployment_id: 'depl_test', provider_sync: 'synced' }]);
  expect(api.state.archivedAt).not.toBeNull();
});

test('a rejected one-off still archives its deployment when member removal wins the row', async () => {
  api.state.onCreate = async () => {
    await db.transaction((tx) => cancelMemberTasks(tx, workspaceId, userId));
  };
  await expect(
    context(() => createTask({ ...scheduleInput(), cron: undefined, runAt: inAnHour() })),
  ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
  expect(api.writes.some((request) => request.path === '/v1/deployments/depl_test/archive')).toBe(
    true,
  );
});

test('a resume the provider schedule refuses keeps the edit and leaves the task paused', async () => {
  const taskId = await createSchedule();
  await db.execute(sql`update task set status='paused' where id=${taskId}`);
  api.state.status = 'paused';
  const runAt = inAnHour();
  await expect(
    context(async () =>
      updateTask({
        expectedVersion: (await taskRow(taskId)).version,
        userId,
        taskId,
        workspaceId,
        organizationId,
        title: 'Changed',
        description: 'New instructions',
        runAt,
        timezone: 'UTC',
        paused: false,
      }),
    ),
  ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
  const row = await taskRow(taskId);
  expect(row).toMatchObject({ title: 'Changed', status: 'paused', provider_sync: 'synced' });
  expect(new Date(String(row.run_at)).getTime()).toBe(runAt.getTime());
  expect(api.writes.some((request) => request.path.endsWith('/unpause'))).toBe(false);
});

test('run now is free again as soon as its run is adopted', async () => {
  const taskId = await createSchedule();
  let count = 0;
  api.state.run = () => scheduleRun(`sesn_${++count}`);
  await context(() => runTaskNow({ taskId, workspaceId, userId }));
  await context(() => runTaskNow({ taskId, workspaceId, userId }));
  expect(count).toBe(2);
  expect((await taskRow(taskId)).run_now_claimed_at).toBeNull();
});

test('an unanswered run now blocks a second run until the run log shows the first', async () => {
  const taskId = await createSchedule();
  api.state.run = () =>
    Response.json({ type: 'error', error: { type: 'api_error' } }, { status: 500 });
  await expect(context(() => runTaskNow({ taskId, workspaceId, userId }))).rejects.toThrow();
  await expect(context(() => runTaskNow({ taskId, workspaceId, userId }))).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  scheduleRun('sesn_lost');
  api.state.deploymentRuns = [
    { id: 'drun_lost', deployment_id: 'depl_test', session_id: 'sesn_lost', error: null },
  ];
  await db.execute(
    sql`update task set run_now_claimed_at = now() - interval '3 minutes' where id = ${taskId}`,
  );
  await context(reconcileTaskState);
  expect((await taskRow(taskId)).run_now_claimed_at).toBeNull();
  expect(
    (await db.execute(sql`select id from session where anthropic_session_id = 'sesn_lost'`)).rows,
  ).toHaveLength(1);
});

function scheduleRun(sessionId: string) {
  api.state.sessions.set(sessionId, {
    id: sessionId,
    type: 'session',
    status: 'idle',
    metadata: { task_id: api.state.metadata.task_id },
    deployment_id: 'depl_test',
    resources: [],
    created_at: new Date().toISOString(),
  });
  return Response.json({
    id: `drun_${sessionId}`,
    type: 'deployment_run',
    deployment_id: 'depl_test',
    session_id: sessionId,
    error: null,
  });
}

test("a saved time zone or name reaches the creator's deployments at once, and no one else's", async () => {
  const taskId = await createSchedule();
  expect(api.systemText()).toContain('UTC');
  const writes = api.writes.length;
  await seedUser(db, 'user_someone_else');
  await context(() => syncCreatorTasks('user_someone_else'));
  expect(api.writes.length).toBe(writes);
  await db.execute(
    sql`update "user" set timezone = 'Europe/Vilnius', name = 'Rūta Renamed' where id = ${userId}`,
  );
  await context(() => syncCreatorTasks(userId));
  expect(api.systemText()).toContain('Europe/Vilnius');
  expect(api.systemText()).toContain('Rūta Renamed');
  expect((await taskRow(taskId)).provider_sync).toBe('synced');
});

test('the snapshot sweep updates a deployment once per changed prompt or skill', async () => {
  const updates = () =>
    deploymentWrites().filter((write) => write.path === '/v1/deployments/depl_test');
  await context(async () => {
    await createTask(scheduleInput());
    await reconcileDeploymentSnapshots();
    const initial = updates().length;
    await reconcileDeploymentSnapshots();
    expect(updates()).toHaveLength(initial);
    api.state.agentSystem = 'Changed prompt';
    await reconcileDeploymentSnapshots();
    expect(updates()).toHaveLength(initial + 1);
    await db.execute(
      sql`insert into skill(kind,owner_workspace_id,name,anthropic_skill_id,latest_version) values('custom',${workspaceId},'Customer skill','skill_custom','1')`,
    );
    await reconcileDeploymentSnapshots();
    expect(updates()).toHaveLength(initial + 2);
    await db.execute(sql`delete from skill`);
    await reconcileDeploymentSnapshots();
    expect(updates()).toHaveLength(initial + 3);
  });
});

test('a snapshot the provider refuses is reported as retryable recovery work', async () => {
  await createSchedule();
  api.state.reject = true;
  await expect(context(reconcileDeploymentSnapshots)).rejects.toBeInstanceOf(DurableRecoveryError);
});
