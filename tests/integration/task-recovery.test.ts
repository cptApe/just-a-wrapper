// The recovery sweeps that repair tasks whose webhook, response or provider call was lost:
// pending pushes, missed and overdue one-offs, creation, removal and trigger receipts.
// Real Postgres; only the Anthropic client, credentials and after() are replaced.
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db';
import { processedWebhookEvent, session, task } from '@/db/schema';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const provider = vi.hoisted(() => ({
  retrieveDeployment: vi.fn(),
  listDeployments: vi.fn(),
  pauseDeployment: vi.fn(),
  archiveDeployment: vi.fn(),
  unpauseDeployment: vi.fn(),
  retrieveSession: vi.fn(),
  listSessions: vi.fn(),
  listEvents: vi.fn(),
}));
const afterResponse = vi.hoisted(() => ({ callbacks: new Array<() => unknown>() }));
vi.mock('next/server', () => ({
  after: (callback: () => unknown) => afterResponse.callbacks.push(callback),
}));
vi.mock('@/features/agents', () => {
  const client = {
    beta: {
      deployments: {
        retrieve: provider.retrieveDeployment,
        list: provider.listDeployments,
        pause: provider.pauseDeployment,
        archive: provider.archiveDeployment,
        unpause: provider.unpauseDeployment,
      },
      sessions: {
        retrieve: provider.retrieveSession,
        list: provider.listSessions,
        events: { list: provider.listEvents },
      },
    },
  };
  return { getAnthropicClient: () => client, requireAnthropicClient: () => client };
});
vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, {
    COMPOSIO_API_KEY: 'test-key',
    MCP_PROXY_URL: 'https://proxy.example.test/api/mcp/composio',
    MCP_PROXY_JWT_SECRET: 'proxy-secret',
  }),
);
const { reconcileTaskState } = await import('@/features/tasks/api/reconcile-task-state');
const { syncTaskProvider } = await import('@/features/tasks/api/sync-task-provider');
const { recoverTriggerDelivery } = await import('@/features/tasks/api/recover-trigger-delivery');
const { withRequestContext } = await import('@/lib/request-context');
const pool = makeTestPool();
const database = makeTestDb(pool);
const organizationId = 'task_recovery_org';
const userId = 'task_recovery_user';
let workspaceId: string;

beforeAll(() => applyMigrations(database));
beforeEach(async () => {
  afterResponse.callbacks.length = 0;
  await truncateAll(database);
  await seedOrganization(database, organizationId);
  await seedUser(database, userId);
  workspaceId = randomUUID();
  await database.execute(sql`insert into workspace (id, organization_id, name)
    values (${workspaceId}, ${organizationId}, 'Recovery')`);
  vi.resetAllMocks();
  provider.retrieveDeployment.mockResolvedValue({
    status: 'active',
    archived_at: null,
    schedule: null,
  });
  provider.listDeployments.mockReturnValue([]);
  provider.listSessions.mockReturnValue([]);
  provider.retrieveSession.mockResolvedValue({
    resources: [],
    status: 'idle',
  });
  provider.listEvents.mockResolvedValue([
    { type: 'session.status_idle', stop_reason: { type: 'requires_action' } },
  ]);
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => pool.end());

async function seedTask(
  status: typeof task.$inferSelect.status,
  providerSync: typeof task.$inferSelect.providerSync = 'synced',
) {
  const rows = await db
    .insert(task)
    .values({
      workspaceId,
      createdByUserId: userId,
      title: 'Recovery task',
      status,
      providerSync,
      triggerType: 'schedule',
      cronSchedule: '0 9 * * *',
      anthropicDeploymentId: `deployment-${randomUUID()}`,
      updatedAt: new Date(Date.now() - 10 * 60_000),
    })
    .returning();
  const row = rows.at(0);
  if (!row) throw new Error('Task fixture missing');
  return row;
}
async function readStatus(id: string) {
  const rows = await db.select({ status: task.status }).from(task).where(eq(task.id, id));
  return rows.at(0)?.status;
}
async function readSync(id: string) {
  const rows = await db.select({ sync: task.providerSync }).from(task).where(eq(task.id, id));
  return rows.at(0)?.sync;
}
function sweep() {
  return withRequestContext({ route: 'test/task-recovery' }, reconcileTaskState);
}

test.each([
  'paused',
  'upcoming',
] as const)('a %s event task whose Composio trigger is gone is removed when its push runs', async (status) => {
  const owner = await seedTask(status, 'status');
  await db
    .update(task)
    .set({
      triggerType: 'event',
      cronSchedule: null,
      anthropicDeploymentId: null,
      composioTriggerId: 'missing-trigger',
    })
    .where(eq(task.id, owner.id));
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
  expect(await syncTaskProvider(owner.id)).toBe('removed');
  expect(await readStatus(owner.id)).toBe('removed');
  expect(await readSync(owner.id)).toBe('synced');
});

test('running tasks parked on the provider cannot starve a pending pause in later sweeps', async () => {
  for (let index = 0; index < 25; index++) {
    const owner = await seedTask('running');
    await db
      .update(task)
      .set({
        cronSchedule: null,
        runAt: new Date(),
        updatedAt: new Date(Date.now() - 20 * 60_000),
      })
      .where(eq(task.id, owner.id));
    await db.insert(session).values({
      workspaceMemoryAccess: 'read_write',
      workspaceId,
      createdByUserId: userId,
      tier: 'default',
      kind: 'task_run',
      taskId: owner.id,
      anthropicSessionId: `parked-${index}`,
    });
  }
  const claimed = await seedTask('paused', 'status');
  for (let attempt = 0; attempt < 10 && (await readSync(claimed.id)) !== 'synced'; attempt++) {
    await sweep();
  }
  expect(await readSync(claimed.id)).toBe('synced');
  expect(provider.pauseDeployment).toHaveBeenCalledWith(
    claimed.anthropicDeploymentId,
    {},
    { timeout: 30_000 },
  );
  const parked = await db.select().from(task).where(eq(task.status, 'running'));
  expect(parked).toHaveLength(25);
});

test.each([
  'schedule',
  'event',
] as const)('the sweep closes an expired credit-paused %s run and keeps a fresh one resumable', async (triggerType) => {
  const owner = await seedTask('upcoming');
  if (triggerType === 'event')
    await db
      .update(task)
      .set({
        triggerType,
        cronSchedule: null,
        anthropicDeploymentId: null,
      })
      .where(eq(task.id, owner.id));
  for (const expired of [true, false])
    await db.insert(session).values({
      workspaceMemoryAccess: 'read_write',
      workspaceId,
      createdByUserId: userId,
      tier: 'default',
      kind: 'task_run',
      taskId: owner.id,
      anthropicSessionId: expired ? 'expired' : 'resumable',
      status: 'paused_no_credits',
      pausedReason: 'credits',
      pausedAt: new Date(Date.now() - (expired ? 31 : 1) * 60_000),
    });
  await sweep();
  const runs = await db.select().from(session).where(eq(session.taskId, owner.id));
  expect(runs.find((run) => run.anthropicSessionId === 'expired')?.endedAt).toBeInstanceOf(Date);
  expect(runs.find((run) => run.anthropicSessionId === 'resumable')?.endedAt).toBeNull();
  expect(await readStatus(owner.id)).toBe('upcoming');
  if (triggerType === 'schedule') expect(provider.retrieveDeployment).toHaveBeenCalled();
});

test('a running task with no run anywhere, archived ones included, is removed and archived', async () => {
  const owner = await seedTask('running');
  await sweep();
  expect(await readStatus(owner.id)).toBe('removed');
  expect(provider.archiveDeployment).toHaveBeenCalled();
  expect(provider.listSessions).toHaveBeenCalledWith(
    expect.objectContaining({
      deployment_id: owner.anthropicDeploymentId,
      include_archived: true,
      limit: 100,
    }),
    { timeout: 30_000 },
  );
});

test('creation recovery finds a deployment stamped slightly before the task by clock skew', async () => {
  const owner = await seedTask('creating');
  provider.listDeployments.mockImplementation((query) => {
    const createdAt = new Date(owner.createdAt.getTime() - 30_000);
    return new Date(query['created_at[gte]']) <= createdAt
      ? [
          {
            id: 'recovered',
            metadata: { task_id: owner.id },
            schedule: null,
          },
        ]
      : [];
  });
  await sweep();
  expect(await readStatus(owner.id)).toBe('upcoming');
});

test('a trigger receipt whose task is gone ends as failed without asking the provider', async () => {
  await db.insert(processedWebhookEvent).values({
    provider: 'composio',
    eventId: 'orphan',
    eventType: 'test',
    processedAt: new Date(Date.now() - 10 * 60_000),
    payload: { state: 'creating', taskId: randomUUID(), sessionId: randomUUID() },
  });
  await recoverTriggerDelivery('orphan');
  const rows = await db
    .select()
    .from(processedWebhookEvent)
    .where(
      and(
        eq(processedWebhookEvent.provider, 'composio'),
        eq(processedWebhookEvent.eventId, 'orphan'),
      ),
    );
  expect(rows.at(0)?.payload).toMatchObject({ state: 'failed', errorCode: 'TASK_NOT_FOUND' });
  expect(provider.listSessions).not.toHaveBeenCalled();
});

test('a new recurring run still reaches the creator live when refreshing its deployment fails', async () => {
  const { adoptTaskRunSession } = await import('@/features/tasks/api/adopt-task-run');
  const { realtimeEvent } = await import('@/db/schema');
  const owner = await seedTask('upcoming');
  provider.retrieveSession.mockResolvedValue({
    resources: [],
    id: 'announced-run',
    metadata: { task_id: owner.id },
    deployment_id: owner.anthropicDeploymentId,
    status: 'running',
    created_at: new Date().toISOString(),
  });
  provider.retrieveDeployment.mockRejectedValue(new Error('refresh failed'));
  await expect(
    withRequestContext({ route: 'test/announce-before-refresh' }, async () =>
      adoptTaskRunSession(await provider.retrieveSession()),
    ),
  ).rejects.toThrow('refresh failed');
  for (const callback of afterResponse.callbacks.splice(0)) await callback();
  const events = await db
    .select()
    .from(realtimeEvent)
    .where(eq(realtimeEvent.type, 'session_status'));
  expect(events).toHaveLength(1);
  expect(events.at(0)?.audienceUserId).toBe(userId);
});

test('an event run whose opening never sent is cleaned up and its receipt failed', async () => {
  const owner = await seedTask('upcoming');
  await db.update(task).set({ notification: 'off' }).where(eq(task.id, owner.id));
  const id = randomUUID();
  await db.insert(session).values({
    workspaceMemoryAccess: 'read_write',
    id,
    workspaceId,
    createdByUserId: userId,
    tier: 'default',
    kind: 'task_run',
    taskId: owner.id,
    status: 'awaiting_opening',
    anthropicSessionId: 'unopened-trigger',
    statusChangedAt: new Date(Date.now() - 6 * 60_000),
  });
  await db.insert(processedWebhookEvent).values({
    provider: 'composio',
    eventId: 'unopened',
    eventType: 'test',
    processedAt: new Date(Date.now() - 10 * 60_000),
    payload: { state: 'creating', taskId: owner.id, sessionId: id },
  });
  await recoverTriggerDelivery('unopened');
  expect((await db.select().from(session).where(eq(session.id, id))).at(0)?.status).toBe(
    'creation_cleanup',
  );
  expect(
    (
      await db
        .select()
        .from(processedWebhookEvent)
        .where(eq(processedWebhookEvent.eventId, 'unopened'))
    ).at(0)?.payload,
  ).toMatchObject({ state: 'failed', errorCode: 'OPENING_MESSAGE_MISSING' });
});

test('a one-off run whose webhook was missed is adopted and its deployment archived', async () => {
  const owner = await seedTask('upcoming');
  await db
    .update(task)
    .set({ runAt: new Date(Date.now() - 20 * 60_000), cronSchedule: null, notification: 'off' })
    .where(eq(task.id, owner.id));
  provider.listSessions.mockReturnValue([
    {
      resources: [],
      id: 'unseen-run',
      metadata: { task_id: owner.id },
      deployment_id: owner.anthropicDeploymentId,
      status: 'running',
      created_at: new Date().toISOString(),
    },
  ]);
  await sweep();
  expect(await readStatus(owner.id)).toBe('running');
  expect(provider.archiveDeployment).toHaveBeenCalled();
  expect((await db.select().from(session)).at(0)?.anthropicSessionId).toBe('unseen-run');
});

test('an overdue one-off with no run is removed and archived before it can repeat next year', async () => {
  const owner = await seedTask('upcoming');
  await db
    .update(task)
    .set({ runAt: new Date(Date.now() - 20 * 60_000), cronSchedule: null })
    .where(eq(task.id, owner.id));
  await sweep();
  expect(await readStatus(owner.id)).toBe('removed');
  expect(provider.archiveDeployment).toHaveBeenCalled();
});

test('a pending resume is never pushed for a one-off whose time has passed', async () => {
  const owner = await seedTask('upcoming', 'status');
  await db
    .update(task)
    .set({ runAt: new Date(Date.now() - 20 * 60_000), cronSchedule: null, notification: 'off' })
    .where(eq(task.id, owner.id));
  provider.retrieveDeployment.mockResolvedValue({
    status: 'paused',
    archived_at: null,
    schedule: null,
  });
  await sweep();
  expect(provider.unpauseDeployment).not.toHaveBeenCalled();
  expect(provider.archiveDeployment).toHaveBeenCalled();
  expect(await readStatus(owner.id)).toBe('removed');
});

test("a removed member's tasks stop at once and their deployments are archived on retry after an outage", async () => {
  const { revokeMemberWorkspaceAccess } = await import(
    '@/features/workspaces/api/revoke-member-workspace-access'
  );
  const owner = await seedTask('upcoming');
  await db.transaction((tx) => revokeMemberWorkspaceAccess(tx, organizationId, userId));
  expect(await readStatus(owner.id)).toBe('removed');
  provider.archiveDeployment.mockRejectedValueOnce(new Error('offline'));
  await expect(syncTaskProvider(owner.id)).rejects.toThrow('offline');
  expect(await readSync(owner.id)).toBe('status');
  expect(await syncTaskProvider(owner.id)).toBe('synced');
  expect(await readSync(owner.id)).toBe('synced');
});

test('creation recovery keeps an elapsed one-off so its run can still be found', async () => {
  const owner = await seedTask('creating');
  await db
    .update(task)
    .set({
      runAt: new Date(Date.now() - 20 * 60_000),
      cronSchedule: null,
      anthropicDeploymentId: null,
    })
    .where(eq(task.id, owner.id));
  provider.listDeployments.mockReturnValue([
    {
      id: 'recovered-elapsed',
      metadata: { task_id: owner.id },
      schedule: { upcoming_runs_at: ['2030-01-01T00:00:00Z'] },
    },
  ]);
  await sweep();
  expect(await readStatus(owner.id)).toBe('upcoming');
  expect(provider.archiveDeployment).not.toHaveBeenCalled();
});

test('removing a task archives a deployment whose create response was lost', async () => {
  const owner = await seedTask('removed', 'status');
  await db.update(task).set({ anthropicDeploymentId: null }).where(eq(task.id, owner.id));
  provider.listDeployments.mockReturnValue([
    { id: 'lost-response', metadata: { task_id: owner.id }, archived_at: null },
  ]);
  await sweep();
  expect(provider.archiveDeployment).toHaveBeenCalledWith('lost-response', {}, { timeout: 30_000 });
  expect(await readSync(owner.id)).toBe('synced');
});

test('recurring run discovery looks back a full day even after a newer run', async () => {
  const owner = await seedTask('upcoming');
  const createdAt = new Date(Date.now() - 2 * 24 * 60 * 60_000);
  await db.update(task).set({ createdAt, lastRunAt: new Date() }).where(eq(task.id, owner.id));
  const before = Date.now();
  await sweep();
  const cutoff = Date.parse(provider.listSessions.mock.calls[0]?.[0]['created_at[gte]']);
  expect(cutoff).toBeGreaterThanOrEqual(before - 24 * 60 * 60_000);
  expect(cutoff).toBeLessThanOrEqual(Date.now() - 24 * 60 * 60_000);
});

test('a missed one-off notifies its creator and no other member', async () => {
  const owner = await seedTask('upcoming');
  await seedUser(database, 'other');
  for (const id of [userId, 'other']) {
    await database.execute(
      sql`insert into member(id,organization_id,user_id,role,created_at) values(${id},${organizationId},${id},'member',now())`,
    );
    await database.execute(
      sql`insert into workspace_member(organization_id,user_id,composio_user_id) values(${organizationId},${id},${id})`,
    );
  }
  await db
    .update(task)
    .set({ runAt: new Date(Date.now() - 20 * 60_000), cronSchedule: null, notification: 'app' })
    .where(eq(task.id, owner.id));
  await sweep();
  expect((await database.execute(sql`select recipient_user_id from notification`)).rows).toEqual([
    { recipient_user_id: userId },
  ]);
  expect(await readStatus(owner.id)).toBe('removed');
});

test('a one-off run older than a day is adopted instead of reported missed', async () => {
  const owner = await seedTask('upcoming');
  const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60_000);
  const runAt = new Date(Date.now() - 25 * 60 * 60_000);
  await db
    .update(task)
    .set({ createdAt, runAt, cronSchedule: null, notification: 'off' })
    .where(eq(task.id, owner.id));
  provider.listSessions.mockImplementation((parameters) =>
    Date.parse(parameters['created_at[gte]']) <= runAt.getTime()
      ? [
          {
            resources: [],
            id: 'older-one-off',
            metadata: { task_id: owner.id },
            deployment_id: owner.anthropicDeploymentId,
            status: 'terminated',
            created_at: runAt.toISOString(),
          },
        ]
      : [],
  );
  await sweep();
  expect(await readStatus(owner.id)).toBe('done');
  expect((await db.select().from(session)).at(0)?.anthropicSessionId).toBe('older-one-off');
  expect(provider.listSessions.mock.calls[0]?.[0]['created_at[gte]']).toBe(createdAt.toISOString());
});

test('overdue one-offs and pending pushes go first and recurring checks rotate across sweeps', async () => {
  const recurring = [];
  for (let index = 0; index < 30; index++) recurring.push(await seedTask('upcoming'));
  const overdue = await seedTask('upcoming');
  const urgent = await seedTask('paused', 'status');
  await db
    .update(task)
    .set({ runAt: new Date(Date.now() - 20 * 60_000), cronSchedule: null, notification: 'off' })
    .where(eq(task.id, overdue.id));
  await sweep();
  expect(await readStatus(overdue.id)).toBe('removed');
  expect(await readSync(urgent.id)).toBe('synced');
  const checked = new Set(
    provider.listSessions.mock.calls.map(([parameters]) => parameters.deployment_id),
  );
  expect(checked.has(overdue.anthropicDeploymentId)).toBe(true);
  const unchecked = recurring.filter((row) => !checked.has(row.anthropicDeploymentId));
  expect(unchecked).toHaveLength(6);
  provider.listSessions.mockClear();
  await sweep();
  const next = provider.listSessions.mock.calls
    .slice(0, 10)
    .map(([parameters]) => parameters.deployment_id);
  // Recovery starts ten requests together; their database reads may finish in a different order.
  for (const row of unchecked) expect(next).toContain(row.anthropicDeploymentId);
  expect(
    new Set(provider.listSessions.mock.calls.map(([parameters]) => parameters.deployment_id)).size,
  ).toBe(25);
});
