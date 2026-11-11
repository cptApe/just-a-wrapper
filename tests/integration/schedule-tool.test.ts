// The agent's schedule tools: create, update and delete a schedule on real Postgres and the real SDK;
// only deployment HTTP is replaced.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { seedCreditBalance } from './helpers/billing-ledger';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-deployment-key';
  process.env.ANTHROPIC_AGENT_ID_DEFAULT = 'agent_test';
  process.env.ANTHROPIC_ENVIRONMENT_ID = 'env_test';
});
const { createScheduleTool, updateScheduleTool, deleteScheduleTool } = await import(
  '@/features/tools/custom-tools/schedules'
);
const { withRequestContext } = await import('@/lib/request-context');
const pool = makeTestPool();
const database = makeTestDb(pool);
const workspaceId = randomUUID();
const context = {
  workspaceId,
  userId: 'owner',
  sessionId: 'upstream-session',
  sessionRowId: randomUUID(),
};
let finishTaskOnUpdate: string | null = null;
let archived = false;
let nextProviderRunAt: string;
beforeAll(async () => applyMigrations(database));
afterAll(async () => {
  vi.restoreAllMocks();
  await pool.end();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  finishTaskOnUpdate = null;
  archived = false;
  nextProviderRunAt = new Date(Date.now() + 7 * 86400000).toISOString();
  await truncateAll(database);
  await seedUser(database, 'owner');
  await seedUser(database, 'other');
  await seedOrganization(database, 'schedule-tools');
  await database.execute(sql`update "user" set timezone = 'Europe/Vilnius' where id = 'owner'`);
  await database.execute(sql`insert into workspace (id, organization_id, name, plan_tier, plan_billing_interval, plan_credits, stripe_subscription_id)
    values (${workspaceId}, 'schedule-tools', 'Tools', 'pro', 'month', 400, 'sub_tools')`);
  await seedCreditBalance(database, workspaceId, 1000000);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (
      finishTaskOnUpdate !== null &&
      request.method === 'POST' &&
      path === '/v1/deployments/depl_test'
    ) {
      await database.execute(
        sql`update task set status = 'done', next_run_at = null, version = version + 1 where id = ${finishTaskOnUpdate}`,
      );
    }
    if (path.endsWith('/archive')) archived = true;
    if (path.startsWith('/v1/agents/')) return Response.json({ id: 'agent_test', version: 'v1' });
    if (path.startsWith('/v1/deployments'))
      return Response.json({
        id: 'depl_test',
        status: 'active',
        archived_at: archived ? new Date().toISOString() : null,
        schedule: { upcoming_runs_at: [nextProviderRunAt] },
      });
    throw new Error(`Unexpected HTTP request: ${request.method} ${path}`);
  });
});
async function stored(taskId: string) {
  return (
    await database.execute(
      sql`select title, description, timezone, cron_schedule, run_at, success_criteria, notification from task where id = ${taskId}`,
    )
  ).rows.at(0);
}
function run(work: () => Promise<void>) {
  return withRequestContext({ route: 'test/schedule-tools' }, work);
}

test("a schedule uses the creator's saved time zone and an update keeps the fields it leaves out", () =>
  run(async () => {
    const created = await createScheduleTool.handler(
      {
        title: 'Client review',
        prompt: 'Review messages',
        cron: '0 9 * * 1',
        success_criteria: 'Include links',
      },
      context,
    );
    await updateScheduleTool.handler(
      { schedule_id: created.schedule_id, title: 'Weekly review' },
      context,
    );
    expect(await stored(created.schedule_id)).toMatchObject({
      title: 'Weekly review',
      description: 'Review messages',
      timezone: 'Europe/Vilnius',
      cron_schedule: '0 9 * * 1',
      run_at: null,
      success_criteria: 'Include links',
      notification: 'email_app',
    });
  }));

test("the agent of another member cannot update or delete a member's private schedule", () =>
  run(async () => {
    const created = await createScheduleTool.handler(
      { title: 'Client review', prompt: 'Review messages', cron: '0 9 * * 1' },
      context,
    );
    const other = { ...context, userId: 'other' };
    await expect(
      updateScheduleTool.handler({ schedule_id: created.schedule_id, title: 'Changed' }, other),
    ).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
    await expect(
      deleteScheduleTool.handler(
        { schedule_id: created.schedule_id, title: 'Client review' },
        other,
      ),
    ).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
    expect(await stored(created.schedule_id)).toMatchObject({ title: 'Client review' });
  }));

test('switching between one-off and recurring never leaves both times set', () =>
  run(async () => {
    const runAt = new Date(Math.floor((Date.now() + 7 * 86400000) / 60000) * 60000).toISOString();
    nextProviderRunAt = runAt;
    const created = await createScheduleTool.handler(
      { title: 'Client review', prompt: 'Review messages', run_at: runAt },
      context,
    );
    await updateScheduleTool.handler(
      { schedule_id: created.schedule_id, cron: '0 9 * * 1' },
      context,
    );
    expect(await stored(created.schedule_id)).toMatchObject({
      cron_schedule: '0 9 * * 1',
      run_at: null,
    });
    await updateScheduleTool.handler({ schedule_id: created.schedule_id, run_at: runAt }, context);
    const row = await stored(created.schedule_id);
    expect(row?.cron_schedule).toBeNull();
    expect(new Date(String(row?.run_at)).toISOString()).toBe(runAt);
  }));

test('a one-off that already ran cannot be rescheduled', () =>
  run(async () => {
    const runAt = new Date(Math.floor((Date.now() + 7 * 86400000) / 60000) * 60000).toISOString();
    nextProviderRunAt = runAt;
    const created = await createScheduleTool.handler(
      { title: 'Client review', prompt: 'Review messages', run_at: runAt },
      context,
    );
    await database.execute(
      sql`update task set status = 'done', last_run_at = now(), next_run_at = null where id = ${created.schedule_id}`,
    );
    await expect(
      updateScheduleTool.handler(
        {
          schedule_id: created.schedule_id,
          run_at: new Date(Date.now() + 14 * 86400000).toISOString(),
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
  }));

test('an edit with a pause saves both, and a later edit without pause keeps it paused', () =>
  run(async () => {
    const created = await createScheduleTool.handler(
      { title: 'Review', prompt: 'Review messages', cron: '0 9 * * 1' },
      context,
    );
    const paused = await updateScheduleTool.handler(
      { schedule_id: created.schedule_id, title: 'Paused review', paused: true },
      context,
    );
    expect(paused).toMatchObject({ title: 'Paused review', paused: true });
    await updateScheduleTool.handler(
      { schedule_id: created.schedule_id, title: 'Still paused' },
      context,
    );
    const row = await database.execute(
      sql`select status, next_run_at from task where id = ${created.schedule_id}`,
    );
    expect(row.rows).toEqual([{ status: 'paused', next_run_at: null }]);
    const resumed = await updateScheduleTool.handler(
      { schedule_id: created.schedule_id, title: 'Resumed', paused: false },
      context,
    );
    expect(resumed).toMatchObject({ title: 'Resumed', paused: false });
  }));

test('a task that finishes during an edit keeps the edit and its deployment is archived', () =>
  run(async () => {
    const created = await createScheduleTool.handler(
      { title: 'Review', prompt: 'Review messages', cron: '0 9 * * 1' },
      context,
    );
    finishTaskOnUpdate = created.schedule_id;
    await updateScheduleTool.handler(
      { schedule_id: created.schedule_id, title: 'Changed', paused: true },
      context,
    );
    const row = await database.execute(
      sql`select title, status, next_run_at, provider_sync from task where id = ${created.schedule_id}`,
    );
    expect(row.rows).toEqual([
      { title: 'Changed', status: 'done', next_run_at: null, provider_sync: 'synced' },
    ]);
    expect(archived).toBe(true);
  }));
