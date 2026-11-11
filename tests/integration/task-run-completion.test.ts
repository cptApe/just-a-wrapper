// Scheduled runs from the provider side: deployment webhooks, run adoption, completion, outcome
// reviews and the sweep that finishes runs whose webhook never came. Real Postgres; only the
// Anthropic client is replaced.
import { randomUUID } from 'node:crypto';
import { APIError } from '@anthropic-ai/sdk';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const provider = vi.hoisted(() => ({
  deployments: { pause: vi.fn(), archive: vi.fn(), retrieve: vi.fn() },
  deploymentRuns: { retrieve: vi.fn() },
  sessions: { retrieve: vi.fn(), events: { list: vi.fn() } },
}));
vi.mock('@/features/agents', async (actual) => {
  const client = { beta: provider };
  return {
    ...(await actual<typeof import('@/features/agents')>()),
    getAnthropicClient: () => client,
    requireAnthropicClient: () => client,
  };
});

const { completeDeploymentRunFailure, completeTaskRun } = await import(
  '@/features/tasks/api/complete-task-run'
);
const { adoptTaskRunBySessionId, adoptTaskRunSession } = await import(
  '@/features/tasks/api/adopt-task-run'
);
const { listScheduledItems } = await import('@/features/tasks/api/list-scheduled-items');
const { recordTaskRunReview } = await import('@/features/tasks/api/record-task-run-review');
const { persistTaskReview } = await import('@/features/tasks/api/task-review-transitions');
const { deleteTask, mirrorDeploymentState } = await import('@/features/tasks/api/task-lifecycle');
const { reconcileTaskState } = await import('@/features/tasks/api/reconcile-task-state');
const { withRequestContext } = await import('@/lib/request-context');

const pool = makeTestPool();
const db = makeTestDb(pool);
const ORG = 'org_task_runs';
const USER = 'user_task_runs';
const activeDeployment = {
  status: 'active',
  archived_at: null,
  schedule: { last_run_at: '2026-08-18T11:00:00.000Z', upcoming_runs_at: [] },
};

beforeAll(() => applyMigrations(db));
beforeEach(async () => {
  await truncateAll(db);
  await seedOrganization(db, ORG);
  await seedUser(db, USER);
  vi.resetAllMocks();
  provider.deployments.pause.mockResolvedValue({});
  provider.deployments.retrieve.mockResolvedValue(activeDeployment);
  // Once archived, the provider reports the deployment as archived.
  provider.deployments.archive.mockImplementation(async () => {
    provider.deployments.retrieve.mockResolvedValue({
      status: 'active',
      archived_at: '2026-11-01',
      schedule: null,
    });
    return {};
  });
  provider.deploymentRuns.retrieve.mockResolvedValue({
    id: 'drun_failed',
    deployment_id: 'depl_task',
    error: { type: 'runtime_error', message: 'failed before session creation' },
  });
  provider.sessions.retrieve.mockResolvedValue({ resources: [], status: 'idle' });
  provider.sessions.events.list.mockResolvedValue([
    { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
  ]);
});
afterAll(() => pool.end());

const context = <T>(run: () => Promise<T>) => withRequestContext({ route: 'test/task-runs' }, run);
const sweep = () => context(reconcileTaskState);

async function seedTask(status = 'upcoming', deploymentId = 'depl_task') {
  const taskId = randomUUID();
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into workspace (id, organization_id, name) values (${randomUUID()}, ${ORG}, 'Runs')
        on conflict (organization_id) do update set name = excluded.name returning id`,
  );
  const workspaceId = requiredRow(rows.at(0)).id;
  await db.execute(sql`insert into task (id, workspace_id, created_by_user_id, title, status,
      trigger_type, cron_schedule, anthropic_deployment_id, next_run_at)
    values (${taskId}, ${workspaceId}, ${USER}, 'Run task', ${status}, 'schedule', '0 * * * *',
      ${deploymentId}, ${new Date('2026-08-18T13:00:00Z')})`);
  return { workspaceId, taskId };
}

/** A task turned into a one-off at `runAt`; `stale` ages it past the sweep's grace period. */
async function seedOneOff(
  status: string,
  { runAt = new Date(), nextRunAt = undefined as Date | null | undefined, stale = false } = {},
) {
  const owner = await seedTask(status);
  await db.execute(sql`update task set cron_schedule = null, run_at = ${runAt},
    updated_at = ${stale ? new Date(Date.now() - 10 * 60_000) : new Date()} where id = ${owner.taskId}`);
  if (nextRunAt !== undefined)
    await db.execute(sql`update task set next_run_at = ${nextRunAt} where id = ${owner.taskId}`);
  return owner;
}

async function seedRun(
  owner: { workspaceId: string; taskId: string },
  anthropicSessionId: string,
  status?: string,
) {
  const id = randomUUID();
  await db.execute(sql`insert into session (workspace_memory_access, id, workspace_id, created_by_user_id,
      tier, kind, task_id, anthropic_session_id)
    values ('read_write', ${id}, ${owner.workspaceId}, ${USER}, 'default', 'task_run', ${owner.taskId},
      ${anthropicSessionId})`);
  if (status) await db.execute(sql`update session set status = ${status} where id = ${id}`);
  return id;
}

type ProviderSession = Parameters<typeof adoptTaskRunSession>[0];
type Verdict = Parameters<typeof persistTaskReview>[2];

/** The provider's session object; the code under test reads only these fields. */
function providerSession(
  id: string,
  taskId: string,
  status = 'idle',
  extra: Record<string, unknown> = {},
): ProviderSession {
  return {
    resources: [],
    id,
    metadata: { task_id: taskId },
    deployment_id: 'depl_task',
    status,
    created_at: new Date().toISOString(),
    ...extra,
  } as unknown as ProviderSession;
}

async function taskStatus(taskId: string) {
  const { rows } = await db.execute<{ status: string; next_run_at: Date | null }>(
    sql`select status, next_run_at from task where id = ${taskId}`,
  );
  return requiredRow(rows.at(0));
}

async function endedAt(anthropicSessionId: string) {
  const { rows } = await db.execute<{ ended_at: Date | null }>(
    sql`select ended_at from session where anthropic_session_id = ${anthropicSessionId}`,
  );
  return requiredRow(rows.at(0)).ended_at;
}

test('a redelivered pause or unpause webhook is applied once', async () => {
  const { taskId } = await seedTask();
  provider.deployments.retrieve.mockResolvedValue({
    status: 'paused',
    archived_at: null,
    schedule: null,
  });
  const pause = { anthropicDeploymentId: 'depl_task', webhookEventId: 'evt_pause' };
  await mirrorDeploymentState(pause);
  await mirrorDeploymentState(pause);
  expect(await taskStatus(taskId)).toMatchObject({ status: 'paused', next_run_at: null });
  provider.deployments.retrieve.mockResolvedValue({
    status: 'active',
    archived_at: null,
    schedule: { upcoming_runs_at: ['2026-12-01T10:00:00Z'] },
  });
  const unpause = { anthropicDeploymentId: 'depl_task', webhookEventId: 'evt_unpause' };
  await mirrorDeploymentState(unpause);
  await mirrorDeploymentState(unpause);
  expect((await taskStatus(taskId)).status).toBe('upcoming');
  const { rows } = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from processed_webhook_event
        where provider = 'anthropic' and event_id in ('evt_pause', 'evt_unpause')`,
  );
  expect(requiredRow(rows.at(0)).count).toBe(2);
});

test('a webhook that loses the row to a concurrent write can be redelivered', async () => {
  const { taskId } = await seedTask();
  provider.deployments.retrieve.mockImplementationOnce(async () => {
    await db.execute(sql`update task set version = version + 1 where id = ${taskId}`);
    return { status: 'paused', archived_at: null, schedule: null };
  });
  const event = { anthropicDeploymentId: 'depl_task', webhookEventId: 'raced-pause' };
  await expect(mirrorDeploymentState(event)).rejects.toMatchObject({ code: 'CONFLICT' });
  const { rows } = await db.execute(
    sql`select event_id from processed_webhook_event where event_id = 'raced-pause'`,
  );
  expect(rows).toEqual([]);
  provider.deployments.retrieve.mockResolvedValue({
    status: 'paused',
    archived_at: null,
    schedule: null,
  });
  await mirrorDeploymentState(event);
  expect((await taskStatus(taskId)).status).toBe('paused');
});

test('a recurring run that failed before starting leaves no phantom run', async () => {
  const { taskId } = await seedTask();
  await completeDeploymentRunFailure({
    anthropicDeploymentRunId: 'drun_failed',
    webhookEventId: 'evt_failed',
    occurredAt: '2026-08-18T12:00:00.000Z',
  });
  const { rows } = await db.execute(sql`select id from session where task_id = ${taskId}`);
  expect(rows).toEqual([]);
  expect((await taskStatus(taskId)).status).toBe('upcoming');
});

test.each([
  'upcoming',
  'paused',
])('a failed %s one-off finishes and is archived instead of running again next year', async (status) => {
  const { taskId } = await seedOneOff(status);
  await completeDeploymentRunFailure({
    anthropicDeploymentRunId: 'failed',
    webhookEventId: `failed-${status}`,
    occurredAt: new Date().toISOString(),
  });
  expect(await taskStatus(taskId)).toMatchObject({ status: 'done', next_run_at: null });
  expect(provider.deployments.archive).toHaveBeenCalledOnce();
});

test('a one-off adopted twice keeps one run, archives once and is not archived again on delete', async () => {
  const runAt = new Date('2026-09-04T06:00:00.000Z');
  const { taskId, workspaceId } = await seedOneOff('upcoming', { runAt, nextRunAt: runAt });
  const session = providerSession('sesn_one_off', taskId, 'idle', {
    created_at: runAt.toISOString(),
  });
  await context(() => adoptTaskRunSession(session));
  await context(() => adoptTaskRunSession(session));
  await context(() =>
    completeTaskRun({
      anthropicSessionId: 'sesn_one_off',
      outcome: 'idle',
      webhookEventId: 'evt_one_off_done',
    }),
  );
  expect(await taskStatus(taskId)).toMatchObject({ status: 'done', next_run_at: null });
  await context(() => deleteTask({ taskId, workspaceId, userId: USER }));
  expect(provider.deployments.archive).toHaveBeenCalledTimes(1);
  expect(await taskStatus(taskId)).toMatchObject({ status: 'removed', next_run_at: null });
  expect((await listScheduledItems({ workspaceId, viewerUserId: USER })).upcoming).toEqual([]);
  const { rows } = await db.execute(sql`select id from session where task_id = ${taskId}`);
  expect(rows).toHaveLength(1);
});

test('a one-off run is kept when archiving its deployment fails', async () => {
  const runAt = new Date('2026-09-04T06:00:00.000Z');
  const { taskId } = await seedOneOff('upcoming', { runAt, nextRunAt: runAt });
  provider.deployments.archive.mockRejectedValueOnce(new Error('provider unavailable'));
  const session = providerSession('sesn_archive_failure', taskId, 'running', {
    created_at: runAt.toISOString(),
  });
  await expect(context(() => adoptTaskRunSession(session))).rejects.toThrow('provider unavailable');
  expect((await taskStatus(taskId)).status).toBe('running');
  const { rows } = await db.execute(sql`select id from session where task_id = ${taskId}`);
  expect(rows).toHaveLength(1);
});

test('a paused one-off is archived only after its adopted run completes', async () => {
  const { taskId } = await seedOneOff('paused');
  await context(() => adoptTaskRunSession(providerSession('paused-run', taskId)));
  expect(provider.deployments.archive).not.toHaveBeenCalled();
  await completeTaskRun({
    anthropicSessionId: 'paused-run',
    outcome: 'idle',
    webhookEventId: 'paused-completion',
  });
  expect((await taskStatus(taskId)).status).toBe('done');
  expect(provider.deployments.archive).toHaveBeenCalledOnce();
});

test.each([
  'done',
  'removed',
  'paused',
])('a late run cannot bring a %s one-off back to running', async (status) => {
  const { taskId } = await seedOneOff(status);
  await db.execute(sql`update task set last_run_at = '2026-11-01' where id = ${taskId}`);
  const late = providerSession('late_run', taskId, 'idle', { created_at: '2026-11-01T12:00:00Z' });
  await context(() => adoptTaskRunSession(late));
  expect((await taskStatus(taskId)).status).toBe(status);
});

test('a late run of a removed task is hidden and closed', async () => {
  const { taskId } = await seedTask('removed');
  provider.sessions.retrieve.mockResolvedValue(providerSession('late-run', taskId, 'running'));
  await context(() => adoptTaskRunBySessionId('late-run'));
  const { rows } = await db.execute<{ status: string; hidden_at: string; ended_at: string }>(
    sql`select status, hidden_at, ended_at from session`,
  );
  expect(requiredRow(rows.at(0))).toMatchObject({
    status: 'terminated',
    hidden_at: expect.anything(),
    ended_at: expect.anything(),
  });
  expect((await taskStatus(taskId)).status).toBe('removed');
});

test('a run cannot be adopted into a workspace being deleted', async () => {
  await seedOrganization(db, 'org_task_runs_deleting');
  const workspaceId = randomUUID();
  const taskId = randomUUID();
  await db.execute(sql`insert into workspace (id, organization_id, name, lifecycle_status, deleted_at)
    values (${workspaceId}, 'org_task_runs_deleting', 'Deleting', 'deleting', now())`);
  await db.execute(sql`insert into task (id, workspace_id, created_by_user_id, title, trigger_type,
      cron_schedule, anthropic_deployment_id)
    values (${taskId}, ${workspaceId}, ${USER}, 'Task', 'schedule', '0 9 * * *', 'depl_task')`);
  provider.sessions.retrieve.mockResolvedValue(providerSession('sesn_deleted_workspace', taskId));
  expect(await adoptTaskRunBySessionId('sesn_deleted_workspace')).toEqual({
    adopted: false,
    reason: 'workspace_deleted',
  });
  expect((await db.execute(sql`select id from session`)).rows).toHaveLength(0);
});

test('a redelivered completion webhook is handled once', async () => {
  const owner = await seedTask('upcoming');
  await seedRun(owner, 'finished', 'idle');
  const complete = () =>
    context(() =>
      completeTaskRun({
        anthropicSessionId: 'finished',
        outcome: 'idle',
        webhookEventId: 'same-completion',
      }),
    );
  expect(await complete()).toMatchObject({ handled: true });
  expect(await complete()).toMatchObject({ handled: false });
});

test('a run waiting for approval keeps its one-off running and its run open', async () => {
  const owner = await seedOneOff('running', { nextRunAt: null });
  await seedRun(owner, 'waiting_run');
  provider.sessions.events.list.mockResolvedValue([
    { type: 'session.status_idle', stop_reason: { type: 'requires_action' } },
  ]);
  expect(
    await completeTaskRun({
      anthropicSessionId: 'waiting_run',
      outcome: 'idle',
      webhookEventId: 'waiting',
    }),
  ).toMatchObject({ handled: false });
  expect((await taskStatus(owner.taskId)).status).toBe('running');
  expect(await endedAt('waiting_run')).toBeNull();
});

test.each([
  'budget_reached',
  'credit_pause',
])('a run stopped by %s stays resumable through both the webhook and the sweep', async (reason) => {
  const owner = await seedOneOff('running', { nextRunAt: null, stale: true });
  const creditPause = reason === 'credit_pause';
  await db.execute(sql`insert into session (workspace_memory_access, workspace_id, created_by_user_id,
      tier, kind, task_id, anthropic_session_id, status, paused_at, paused_reason)
    values ('read_write', ${owner.workspaceId}, ${USER}, 'default', 'task_run', ${owner.taskId}, 'resumable',
      ${creditPause ? 'paused_no_credits' : 'idle'}, ${creditPause ? new Date() : null},
      ${creditPause ? 'credits' : null})`);
  provider.sessions.events.list.mockResolvedValue([
    { type: 'session.status_idle', stop_reason: { type: creditPause ? 'interrupted' : reason } },
  ]);
  expect(
    await completeTaskRun({
      anthropicSessionId: 'resumable',
      outcome: 'idle',
      webhookEventId: 'resumable-event',
    }),
  ).toMatchObject({ handled: false });
  await sweep();
  expect((await taskStatus(owner.taskId)).status).toBe('running');
  expect(await endedAt('resumable')).toBeNull();
});

test.each([
  'webhook',
  'sweep',
])('a credit pause past its window finishes the one-off through the %s', async (path) => {
  const owner = await seedOneOff('running', { nextRunAt: null, stale: true });
  await db.execute(sql`insert into session (workspace_memory_access, workspace_id, created_by_user_id,
      tier, kind, task_id, anthropic_session_id, status, paused_at, paused_reason)
    values ('read_write', ${owner.workspaceId}, ${USER}, 'default', 'task_run', ${owner.taskId}, 'expired',
      'paused_no_credits', now() - interval '31 minutes', 'credits')`);
  provider.sessions.events.list.mockResolvedValue([
    { type: 'session.status_idle', stop_reason: { type: 'budget_reached' } },
  ]);
  if (path === 'webhook')
    await completeTaskRun({
      anthropicSessionId: 'expired',
      outcome: 'idle',
      webhookEventId: 'expired-event',
    });
  else await sweep();
  expect((await taskStatus(owner.taskId)).status).toBe('done');
  expect(await endedAt('expired')).not.toBeNull();
});

test('the sweep finishes a running one-off whose completion webhook never came', async () => {
  const owner = await seedOneOff('running', { nextRunAt: null, stale: true });
  await seedRun(owner, 'missed_run');
  await sweep();
  expect((await taskStatus(owner.taskId)).status).toBe('done');
  expect(provider.deployments.archive).toHaveBeenCalledTimes(1);
});

test('one failed repair in the sweep does not stop the next one-off from finishing', async () => {
  const owners = [await seedTask('running', 'deployment_first')];
  owners.push(await seedTask('running', 'deployment_second'));
  for (const owner of owners) {
    await db.execute(sql`update task set cron_schedule = null, run_at = now(), next_run_at = null,
      updated_at = now() - interval '10 minutes' where id = ${owner.taskId}`);
    await seedRun(owner, owner.taskId);
  }
  provider.deployments.retrieve.mockRejectedValueOnce(new Error('provider unavailable'));
  await expect(sweep()).rejects.toMatchObject({ code: 'EXTERNAL_API_FAILED' });
  const statuses = await Promise.all(
    owners.map(async (owner) => (await taskStatus(owner.taskId)).status),
  );
  expect(statuses).toEqual(['done', 'done']);
});

test('the sweep removes a running task whose run is gone at the provider', async () => {
  const owner = await seedOneOff('running', { nextRunAt: null, stale: true });
  await seedRun(owner, 'missing');
  provider.sessions.retrieve.mockRejectedValue(new APIError(404, {}, 'missing', new Headers()));
  await sweep();
  expect((await taskStatus(owner.taskId)).status).toBe('removed');
});

test.each([
  { result: 'satisfied', iteration: 0, expected: 'passed' },
  { result: 'satisfied', iteration: 1, expected: 'passed_after_revision' },
  { result: 'max_iterations_reached', iteration: 1, expected: 'not_passed' },
])('a $result review at iteration $iteration is saved as $expected once', async ({
  result,
  iteration,
  expected,
}) => {
  const owner = await seedTask('upcoming');
  const rowId = await seedRun(owner, 'sesn_review', 'idle');
  provider.sessions.retrieve.mockResolvedValue(
    providerSession('sesn_review', owner.taskId, 'idle', {
      outcome_evaluations: [{ type: 'outcome_evaluation', outcome_id: 'outc', result, iteration }],
    }),
  );
  const input = { anthropicSessionId: 'sesn_review', webhookEventId: 'evt_review' };
  await expect(context(() => recordTaskRunReview(input))).resolves.toEqual({
    handled: true,
    reviewOutcome: expected,
  });
  await expect(context(() => recordTaskRunReview(input))).resolves.toEqual({
    handled: false,
    reason: 'duplicate',
  });
  const { rows } = await db.execute<{ review_outcome: string }>(
    sql`select review_outcome from session where id = ${rowId}`,
  );
  expect(requiredRow(rows.at(0)).review_outcome).toBe(expected);
});

test('a later verdict cannot overwrite a run that already has a final review', async () => {
  const owner = await seedTask('done');
  await seedRun(owner, 'upstream');
  const session = { ...providerSession('upstream', owner.taskId), deployment_id: 'dep' };
  const evaluation: Verdict = {
    outcomeId: 'outcome',
    result: 'satisfied',
    iteration: 0,
    reviewOutcome: 'passed',
  };
  const review = (webhookEventId: string, verdict: Verdict = evaluation) =>
    persistTaskReview({ anthropicSessionId: 'upstream', webhookEventId }, session, verdict);
  expect(await review('review')).toHaveLength(1);
  expect(await review('later', { ...evaluation, reviewOutcome: 'not_passed' })).toHaveLength(0);
  const { rows } = await db.execute(sql`select review_outcome from session`);
  expect(rows).toEqual([{ review_outcome: 'passed' }]);
});

test('the newest review wins and recording it does not finish or archive the task', async () => {
  const { taskId } = await seedOneOff('done');
  await db.execute(sql`update task set last_run_at = '2026-11-01' where id = ${taskId}`);
  provider.sessions.retrieve.mockResolvedValue(
    providerSession('review_only', taskId, 'idle', {
      created_at: '2026-11-01T12:00:00Z',
      outcome_evaluations: [
        { outcome_id: 'outcome', result: 'satisfied', iteration: 0 },
        { outcome_id: 'outcome', result: 'max_iterations_reached', iteration: 2 },
      ],
    }),
  );
  expect(
    await recordTaskRunReview({ anthropicSessionId: 'review_only', webhookEventId: 'review-only' }),
  ).toMatchObject({ handled: true, reviewOutcome: 'not_passed' });
  expect((await taskStatus(taskId)).status).toBe('done');
  expect(provider.deployments.archive).not.toHaveBeenCalled();
});

test('a run adopted through its review keeps read-only workspace memory read-only', async () => {
  const { taskId, workspaceId } = await seedTask('done', 'dep');
  await db.execute(
    sql`update workspace set workspace_memory_store_id = 'workspace-memory' where id = ${workspaceId}`,
  );
  await persistTaskReview(
    { anthropicSessionId: 'review-run', webhookEventId: 'adopt-review' },
    {
      ...providerSession('review-run', taskId),
      deployment_id: 'dep',
      resources: [
        { type: 'memory_store', memory_store_id: 'workspace-memory', access: 'read_only' },
      ],
    } as ProviderSession,
    { outcomeId: 'outcome', result: 'satisfied', iteration: 0, reviewOutcome: 'passed' },
  );
  const { rows } = await db.execute(
    sql`select workspace_memory_access from session where anthropic_session_id = 'review-run'`,
  );
  expect(rows).toEqual([{ workspace_memory_access: 'read_only' }]);
});
