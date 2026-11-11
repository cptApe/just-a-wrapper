// Task lifecycle: guarded status moves, edits, pause and resume, the plan cap, the scheduled list and
// who may see or control a task. Real Postgres; only the Anthropic and Composio clients are replaced.
import { randomUUID } from 'node:crypto';
import { APIError } from '@anthropic-ai/sdk';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const deployments = vi.hoisted(() => ({
  pause: vi.fn(),
  unpause: vi.fn(),
  archive: vi.fn(),
  retrieve: vi.fn(),
}));
vi.mock('@/features/agents', async (actual) => {
  const client = { beta: { deployments } };
  return {
    ...(await actual<typeof import('@/features/agents')>()),
    getAnthropicClient: () => client,
    requireAnthropicClient: () => client,
  };
});
vi.mock('@/features/tasks/api/composio-triggers', async (actual) => ({
  ...(await actual<typeof import('@/features/tasks/api/composio-triggers')>()),
  requireActiveConnectedAccount: async () => ({ connectedAccountId: 'account_test' }),
  upsertTriggerInstance: async () => ({ triggerId: 'trigger_shared' }),
}));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, {
    COMPOSIO_API_KEY: 'test-composio-key',
    MCP_PROXY_URL: 'https://proxy.example/api/mcp/composio',
    MCP_PROXY_JWT_SECRET: 'test-proxy-secret-at-least-32-characters',
  }),
);

const { db: appDb } = await import('@/db');
const { claimTaskEvent } = await import('@/features/tasks/api/task-event-transitions');
const {
  activateCreatedTask,
  claimProviderSync,
  claimRunNow,
  finishProviderSync,
  moveTask,
  recordEventRunStart,
  refreshRecurringTaskTimes,
  rejectCreatedTaskSchedule,
  releaseRunNow,
  writeTaskDefinition,
} = await import('@/features/tasks/api/task-transitions');
const { createTask } = await import('@/features/tasks/api/create-task');
const { getTaskForEdit, updateTask } = await import('@/features/tasks/api/update-task');
const { deleteTask, pauseTask, resumeTask, runTaskNow } = await import(
  '@/features/tasks/api/task-lifecycle'
);
const { assertCanCreateScheduledTask } = await import('@/features/tasks/api/assert-schedule-limit');
const { listScheduledItems } = await import('@/features/tasks/api/list-scheduled-items');
const { withRequestContext } = await import('@/lib/request-context');

const pool = makeTestPool();
const database = makeTestDb(pool);
const ORG = 'org_task_lifecycle';
const USER = 'user_task_lifecycle';
let workspaceId: string;

beforeAll(() => applyMigrations(database));
beforeEach(async () => {
  await truncateAll(database);
  await seedOrganization(database, ORG);
  await seedUser(database, USER);
  workspaceId = randomUUID();
  await database.execute(
    sql`insert into workspace (id, organization_id, name) values (${workspaceId}, ${ORG}, 'Lifecycle')`,
  );
  vi.resetAllMocks();
  deployments.pause.mockResolvedValue({});
  deployments.unpause.mockResolvedValue({});
  deployments.archive.mockResolvedValue({});
  deployments.retrieve.mockResolvedValue({
    status: 'active',
    archived_at: null,
    schedule: { upcoming_runs_at: [] },
  });
});
afterAll(() => pool.end());

const context = <T>(run: () => Promise<T>) =>
  withRequestContext({ route: 'test/task-lifecycle' }, run);

/** A recurring task; `provider: false` leaves it without a deployment or a next run. */
async function seedTask(status: string, { provider = true, createdBy = USER } = {}) {
  const id = randomUUID();
  await database.execute(sql`insert into task
      (id, workspace_id, created_by_user_id, title, status, trigger_type, cron_schedule,
       anthropic_deployment_id, next_run_at)
    values (${id}, ${workspaceId}, ${createdBy}, 'Lifecycle task', ${status}, 'schedule', '0 9 * * *',
      ${provider ? 'depl_task' : null}, ${provider ? new Date('2026-08-18T13:00:00Z') : null})`);
  return id;
}

async function readTask(taskId: string) {
  const { rows } = await database.execute<{
    status: string;
    version: number;
    provider_sync: string;
    sync_claimed_at: string | null;
    next_run_at: string | null;
    anthropic_deployment_id: string | null;
  }>(sql`select status, version, provider_sync, sync_claimed_at, next_run_at, anthropic_deployment_id
    from task where id = ${taskId}`);
  return requiredRow(rows.at(0));
}

test('a removed task cannot be moved, activated or given run times again', async () => {
  const taskId = await seedTask('removed', { provider: false });
  for (const to of ['running', 'paused', 'upcoming', 'done', 'removed'] as const)
    expect(await moveTask(appDb, { taskId, to, sync: 'status' })).toBeNull();
  expect(await activateCreatedTask({ taskId, deploymentId: 'dep', nextRunAt: null })).toBe(false);
  await refreshRecurringTaskTimes({ taskId, nextRunAt: new Date(), lastRunAt: new Date() });
  expect(await readTask(taskId)).toMatchObject({
    status: 'removed',
    version: 1,
    next_run_at: null,
  });
});

test('a second activation cannot replace the deployment of an activated task', async () => {
  const taskId = await seedTask('creating', { provider: false });
  expect(await activateCreatedTask({ taskId, deploymentId: 'dep', nextRunAt: new Date() })).toBe(
    true,
  );
  expect(await activateCreatedTask({ taskId, deploymentId: 'other', nextRunAt: new Date() })).toBe(
    false,
  );
  expect((await readTask(taskId)).anthropic_deployment_id).toBe('dep');
});

test('a late creation rejection cannot replace the deployment of a finished task', async () => {
  const taskId = await seedTask('done');
  expect(await rejectCreatedTaskSchedule(taskId, 'late-deployment')).toBe(false);
  expect(await readTask(taskId)).toMatchObject({
    status: 'done',
    anthropic_deployment_id: 'depl_task',
  });
});

test('two concurrent edits of one version: only one is saved', async () => {
  const taskId = await seedTask('upcoming', { provider: false });
  const edit = (title: string) =>
    writeTaskDefinition(appDb, {
      taskId,
      expectedVersion: 1,
      definition: { title },
      status: 'upcoming',
      sync: 'definition',
    });
  expect((await Promise.all([edit('First'), edit('Second')])).sort()).toEqual([2, null]);
  expect(await readTask(taskId)).toMatchObject({ version: 2, provider_sync: 'definition' });
});

test('a pause after an edit does not drop the pending definition push', async () => {
  const taskId = await seedTask('upcoming', { provider: false });
  await writeTaskDefinition(appDb, {
    taskId,
    expectedVersion: 1,
    definition: { title: 'Edited' },
    status: 'upcoming',
    sync: 'definition',
  });
  expect(await moveTask(appDb, { taskId, to: 'paused', sync: 'status' })).toBe(3);
  expect(await readTask(taskId)).toMatchObject({ status: 'paused', provider_sync: 'definition' });
});

test('only one worker pushes a task at a time, and a push overtaken by a newer write stays pending', async () => {
  const taskId = await seedTask('upcoming', { provider: false });
  await moveTask(appDb, { taskId, to: 'paused', sync: 'status' });
  const [first, second] = await Promise.all([claimProviderSync(taskId), claimProviderSync(taskId)]);
  expect([first, second].filter(Boolean)).toHaveLength(1);
  const claim = first ?? second;
  if (!claim) throw new Error('No claim');
  // A newer write lands while the push is in flight.
  await moveTask(appDb, { taskId, to: 'upcoming', sync: 'status' });
  expect(await finishProviderSync({ claim })).toBe(false);
  expect(await readTask(taskId)).toMatchObject({ provider_sync: 'status', sync_claimed_at: null });
  const retry = await claimProviderSync(taskId);
  if (!retry) throw new Error('No retry claim');
  expect(await finishProviderSync({ claim: retry, nextRunAt: new Date('2030-01-01') })).toBe(true);
  expect(await readTask(taskId)).toMatchObject({ provider_sync: 'synced', sync_claimed_at: null });
  expect(await claimProviderSync(taskId)).toBeNull();
});

test('two concurrent run-now clicks start one run', async () => {
  const taskId = await seedTask('upcoming', { provider: false });
  const [first, second] = await Promise.all([claimRunNow(taskId), claimRunNow(taskId)]);
  expect([first, second].filter(Boolean)).toHaveLength(1);
  await releaseRunNow(taskId, first ?? second);
  expect(await claimRunNow(taskId)).not.toBeNull();
});

test('one event delivered twice at once is claimed once', async () => {
  const input = { eventId: 'event', eventType: 'test', payload: {} };
  expect(
    (await Promise.all([claimTaskEvent(appDb, input), claimTaskEvent(appDb, input)])).sort(),
  ).toEqual([false, true]);
});

test('an older event run cannot move run times back or revive a removed task', async () => {
  const taskId = await seedTask('removed', { provider: false });
  await database.execute(
    sql`update task set trigger_type = 'event', cron_schedule = null, last_run_at = '2030-01-01', updated_at = '2030-01-01' where id = ${taskId}`,
  );
  await recordEventRunStart(appDb, taskId, new Date('2029-01-01'));
  const { rows } = await database.execute<{
    status: string;
    last_run_at: string;
    updated_at: string;
  }>(sql`select status, last_run_at, updated_at from task where id = ${taskId}`);
  const row = requiredRow(rows.at(0));
  expect(row.status).toBe('removed');
  expect(new Date(row.last_run_at).toISOString()).toBe('2030-01-01T00:00:00.000Z');
  // Run times are a cache, so the definition timestamp stays put.
  expect(new Date(row.updated_at).toISOString()).toBe('2030-01-01T00:00:00.000Z');
});

test('a second task on the same Composio trigger is refused and not saved', async () => {
  await database.execute(sql`insert into workspace_member (organization_id, user_id, composio_user_id)
    values (${ORG}, ${USER}, 'composio_trigger_test')`);
  const create = (title: string) =>
    context(() =>
      createTask({
        triggerType: 'event',
        toolkit: 'gmail',
        eventType: 'GMAIL_NEW_GMAIL_MESSAGE',
        workspaceId,
        organizationId: ORG,
        createdByUserId: USER,
        title,
        description: 'Summarize the new email.',
        tier: 'default',
        autoApprove: false,
        notification: 'off',
        icon: 'bolt',
      }),
    );
  await create('First task');
  await expect(create('Second task')).rejects.toMatchObject({
    code: 'TOOL_INPUT_INVALID',
    context: { eventType: 'GMAIL_NEW_GMAIL_MESSAGE' },
  });
  expect((await database.execute(sql`select id from task`)).rows).toHaveLength(1);
});

test('a user pause is saved before the provider call, and a provider outage leaves the push for retry', async () => {
  const taskId = await seedTask('upcoming');
  deployments.pause.mockImplementationOnce(async () => {
    expect((await readTask(taskId)).status).toBe('paused');
    throw new Error('provider unavailable');
  });
  await context(() => pauseTask({ taskId, workspaceId, userId: USER }));
  expect(await readTask(taskId)).toMatchObject({ status: 'paused', provider_sync: 'status' });
  await context(() => pauseTask({ taskId, workspaceId, userId: USER }));
  expect((await readTask(taskId)).provider_sync).toBe('synced');
});

test('pausing a task whose deployment is gone removes the task', async () => {
  const taskId = await seedTask('upcoming');
  deployments.retrieve.mockRejectedValue(new APIError(404, {}, 'missing', new Headers()));
  await context(() => pauseTask({ taskId, workspaceId, userId: USER }));
  expect((await readTask(taskId)).status).toBe('removed');
});

test('a paused one-off cannot be resumed after its requested time', async () => {
  const taskId = await seedTask('paused');
  await database.execute(
    sql`update task set cron_schedule = null, run_at = now() - interval '1 minute' where id = ${taskId}`,
  );
  await expect(
    context(() => resumeTask({ taskId, workspaceId, userId: USER })),
  ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
  expect((await readTask(taskId)).status).toBe('paused');
});

test('the plan cap counts live and overdue schedules and names the stale ones', async () => {
  const otherUserId = 'user_task_lifecycle_other';
  const futureRun = new Date(Date.now() + 2 * 24 * 60 * 60 * 1_000);
  const overdueRun = new Date(Date.now() - 30 * 60 * 1_000);
  const staleRun = new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000);
  await seedUser(database, otherUserId);
  await database.execute(
    sql`update workspace set plan_tier = 'pro', plan_billing_interval = 'month', plan_credits = 1000, stripe_subscription_id = 'sub_' || id where id = ${workspaceId}`,
  );
  await seedTask('removed');
  const live = Array.from(
    { length: 4 },
    (_, index) =>
      sql`(${randomUUID()}, ${workspaceId}, ${USER}, ${`Live ${index}`}, 'upcoming', 'schedule', '0 9 * * *', null, ${futureRun})`,
  );
  await database.execute(sql`insert into task
      (id, workspace_id, created_by_user_id, title, status, trigger_type, cron_schedule, run_at, next_run_at)
    values ${sql.join(live, sql`, `)},
      (${randomUUID()}, ${workspaceId}, ${USER}, 'Overdue active task', 'upcoming', 'schedule', '0 9 * * *', null, ${overdueRun}),
      (${randomUUID()}, ${workspaceId}, ${USER}, 'Stale dev task', 'upcoming', 'schedule', '0 9 * * *', null, ${staleRun}),
      (${randomUUID()}, ${workspaceId}, ${otherUserId}, 'Private stale task', 'upcoming', 'schedule', '0 9 * * *', null, ${staleRun}),
      (${randomUUID()}, ${workspaceId}, ${USER}, 'Paused task', 'paused', 'schedule', '0 9 * * *', null, null),
      (${randomUUID()}, ${workspaceId}, ${USER}, 'Missed reminder', 'upcoming', 'schedule', null, ${staleRun}, ${staleRun})`);
  await expect(
    context(() =>
      database.transaction((tx) => assertCanCreateScheduledTask(workspaceId, USER, tx)),
    ),
  ).rejects.toMatchObject({
    code: 'PLAN_LIMIT_REACHED',
    context: { scheduled: 5, staleSchedules: ['Stale dev task', 'Missed reminder'] },
  });
});

test.each([
  {
    name: 'a running one-off',
    status: 'running',
    change: sql`cron_schedule = null, run_at = now() - interval '1 minute', last_run_at = now() - interval '1 minute', next_run_at = null`,
    state: 'running',
  },
  {
    name: 'a paused schedule with a pending push',
    status: 'paused',
    change: sql`next_run_at = null, provider_sync = 'status'`,
    state: 'paused',
  },
  {
    name: 'an upcoming schedule with a pending push',
    status: 'upcoming',
    change: sql`next_run_at = null, provider_sync = 'status'`,
    state: 'live',
  },
])('$name stays in the scheduled list without a next run', async ({ status, change, state }) => {
  const taskId = await seedTask(status);
  await database.execute(sql`update task set ${change} where id = ${taskId}`);
  const groups = await listScheduledItems({ workspaceId, viewerUserId: USER });
  expect(groups.upcoming).toContainEqual(expect.objectContaining({ id: taskId, state }));
});

test('finished one-offs cannot push active schedules out of the scheduled list', async () => {
  const futureRun = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const finishedRun = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const active = Array.from(
    { length: 100 },
    (_, index) =>
      sql`(${randomUUID()}, ${workspaceId}, ${USER}, ${`Active ${index}`}, 'upcoming', 'schedule', '0 9 * * *', null, null, ${futureRun})`,
  );
  const finished = Array.from(
    { length: 12 },
    (_, index) =>
      sql`(${randomUUID()}, ${workspaceId}, ${USER}, ${`Finished ${index}`}, 'done', 'schedule', null, ${finishedRun}, ${finishedRun}, null)`,
  );
  await database.execute(sql`insert into task
      (id, workspace_id, created_by_user_id, title, status, trigger_type, cron_schedule, run_at, last_run_at, next_run_at)
    values ${sql.join([...active, ...finished], sql`, `)}`);
  const groups = await listScheduledItems({ workspaceId, viewerUserId: USER });
  expect(groups.upcoming.filter((task) => task.state !== 'finished')).toHaveLength(100);
  expect(groups.upcoming.filter((task) => task.state === 'finished')).toHaveLength(10);
});

test("the scheduled list hides another member's private task, private runs and hidden runs", async () => {
  const taskId = await seedTask('upcoming');
  const other = 'other_schedule_viewer';
  await seedUser(database, other);
  const sharedRun = randomUUID();
  await database.execute(sql`insert into session
    (workspace_memory_access, id, workspace_id, created_by_user_id, tier, kind, task_id, anthropic_session_id, status, visibility, hidden_at, paused_at, paused_reason)
    values
    ('read_write', ${randomUUID()}, ${workspaceId}, ${USER}, 'default', 'task_run', ${taskId}, 'hidden_run', 'terminated', 'workspace', now(), null, null),
    ('read_write', ${randomUUID()}, ${workspaceId}, ${USER}, 'default', 'task_run', ${taskId}, 'private_run', 'paused_no_credits', 'private', null, now(), 'credits'),
    ('read_write', ${sharedRun}, ${workspaceId}, ${USER}, 'default', 'task_run', ${taskId}, 'shared_run', 'idle', 'workspace', null, null, null)`);
  const groups = await listScheduledItems({ workspaceId, viewerUserId: other });
  expect(groups.upcoming).toEqual([]);
  expect(groups.attention).toEqual([]);
  expect(groups.history.map((run) => run.id)).toEqual([sharedRun]);
  expect(groups.history.at(0)).toMatchObject({ taskTitle: null, taskId: null });
  const owner = await listScheduledItems({ workspaceId, viewerUserId: USER });
  expect(owner.upcoming.at(0)?.timesRun).toBe(1);
});

test.each([
  { visibility: 'private', teammateCanRead: false },
  { visibility: 'workspace', teammateCanRead: true },
])('a $visibility task can be changed only by its creator', async ({
  visibility,
  teammateCanRead,
}) => {
  const taskId = await seedTask('upcoming');
  await database.execute(sql`update task set visibility = ${visibility} where id = ${taskId}`);
  const input = { taskId, workspaceId, userId: 'teammate' };
  const read = context(() => getTaskForEdit(input));
  if (teammateCanRead) {
    await expect(read).resolves.toMatchObject({ id: taskId });
    const groups = await listScheduledItems({ workspaceId, viewerUserId: 'teammate' });
    expect(groups.upcoming).toContainEqual(expect.objectContaining({ id: taskId }));
  } else await expect(read).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
  const commands: Array<(command: typeof input) => Promise<unknown>> = [
    pauseTask,
    resumeTask,
    deleteTask,
    runTaskNow,
  ];
  for (const operation of commands)
    await expect(context(() => operation(input))).rejects.toMatchObject({
      code: 'TASK_NOT_FOUND',
    });
  await expect(
    updateTask({
      ...input,
      expectedVersion: 1,
      organizationId: ORG,
      title: 'Stolen',
      description: 'Prompt',
    }),
  ).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
  expect(await readTask(taskId)).toMatchObject({ status: 'upcoming', version: 1 });
});
