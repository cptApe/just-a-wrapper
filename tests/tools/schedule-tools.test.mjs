// What the agent may do to schedules. Timezones, cadence edits and private-schedule refusals run
// on Postgres in tests/integration/schedule-tool.test.ts and tool-resolution.test.ts.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import {
  CREATE_SCHEDULE_DECL,
  UPDATE_SCHEDULE_DECL,
} from '../../src/features/tool-catalog/schedule-declarations.ts';

const dependencies = {
  '@/features/tasks/api/list-scheduled-items': ['listScheduledItems'],
  '@/features/tasks/api/create-task': ['createTask'],
  '@/features/tasks/api/task-lifecycle': ['deleteTask', 'pauseTask', 'resumeTask'],
  '@/features/tasks/api/update-task': ['getTaskForEdit', 'updateTask'],
  '../api/schedule-access': ['getScheduleAccess', 'resolveScheduleContext'],
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const names = dependencies[specifier];
    if (names && context.parentURL?.endsWith('/custom-tools/schedules.ts')) {
      const source = names
        .map(
          (name) =>
            `export const ${name} = (...args) => globalThis.__scheduleToolFixture.${name}(...args);`,
        )
        .join('\n');
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    return nextResolve(specifier, context);
  },
});
const scheduleTools = await import('../../src/features/tools/custom-tools/schedules.ts');
function useFixture(deps) {
  globalThis.__scheduleToolFixture = deps;
  return scheduleTools;
}

const SCHEDULE_ID = '51b2f8f5-f4ec-4f5d-8b45-81348303a7a1';
const ctx = {
  workspaceId: 'workspace-a',
  userId: 'user-a',
  sessionId: 'session-upstream',
  sessionRowId: '51b2f8f5-f4ec-4f5d-8b45-81348303a7a2',
};

function fixture() {
  const calls = [];
  let item = {
    source: 'task',
    id: SCHEDULE_ID,
    href: null,
    title: 'Monday pipeline review',
    description: 'Review the sales pipeline.',
    occurredAt: new Date('2026-09-07T06:00:00.000Z'),
    triggerType: 'schedule',
    state: 'live',
    cronSchedule: '0 9 * * 1',
    eventType: null,
    updatedAt: new Date('2026-09-02T08:00:00.000Z'),
    timesRun: 0,
    latestReviewOutcome: null,
    createdByUserId: ctx.userId,
    visibility: 'private',
    status: 'upcoming',
    nextRunAt: new Date('2026-09-07T06:00:00.000Z'),
    runAt: null,
    lastRunAt: null,
    timezone: 'Europe/Vilnius',
  };
  const deps = {
    async createTask(input) {
      calls.push(['create', input]);
      item = { ...item, title: input.title, description: input.description };
      return { taskId: SCHEDULE_ID };
    },
    async listScheduledItems(input) {
      calls.push(['list', input]);
      return { upcoming: [item] };
    },
    async getTaskForEdit(input) {
      calls.push(['get', input]);
      if (input.workspaceId !== ctx.workspaceId) {
        const error = new Error('Task not found');
        error.code = 'TASK_NOT_FOUND';
        throw error;
      }
      return {
        id: item.id,
        title: item.title,
        description: item.description,
        successCriteria: '',
        triggerType: item.triggerType,
        tier: 'pro',
        autoApprove: false,
        cron: item.cronSchedule,
        runAt: item.runAt,
        timezone: 'Europe/Vilnius',
        toolkit: null,
        eventType: null,
      };
    },
    async updateTask(input) {
      calls.push(['update', input]);
      if (input.paused !== undefined)
        item = { ...item, status: input.paused ? 'paused' : 'upcoming' };
      const runAt = input.runAt ?? null;
      const cron = input.cron ?? null;
      item = {
        ...item,
        title: input.title,
        description: input.description,
        occurredAt: runAt ?? item.occurredAt,
        nextRunAt: runAt ?? item.nextRunAt,
        cronSchedule: cron,
        runAt,
      };
    },
    async pauseTask(input) {
      calls.push(['pause', input]);
      item = { ...item, state: 'paused', status: 'paused', occurredAt: null, nextRunAt: null };
    },
    async resumeTask(input) {
      calls.push(['resume', input]);
      item = {
        ...item,
        state: 'live',
        status: 'upcoming',
        occurredAt: new Date('2026-09-07T06:00:00.000Z'),
        nextRunAt: new Date('2026-09-07T06:00:00.000Z'),
      };
    },
    async deleteTask(input) {
      calls.push(['delete', input]);
    },
    async getScheduleAccess(input) {
      calls.push(['access', input]);
      if (input.workspaceId !== ctx.workspaceId || input.taskId !== item.id) return null;
      return item;
    },
    async resolveScheduleContext(input) {
      calls.push(['caller', input]);
      return { organizationId: 'org-a', tier: 'pro', timezone: 'Europe/Vilnius' };
    },
  };
  return { calls, deps, getItem: () => item };
}

test('a schedule the agent creates belongs to the member who asked and never approves its own actions', async () => {
  const f = fixture();
  const { createScheduleTool } = useFixture(f.deps);
  const input = createScheduleTool.inputSchema.parse({
    title: 'Monday pipeline review',
    prompt: 'Review the sales pipeline.',
    cron: '0 9 * * 1',
    timezone: 'Europe/Vilnius',
    auto_approve: true,
  });
  await createScheduleTool.handler(input, ctx);
  const create = f.calls.find(([name]) => name === 'create')[1];
  assert.equal(create.workspaceId, ctx.workspaceId);
  assert.equal(create.createdByUserId, ctx.userId);
  assert.equal(create.autoApprove, false);
  for (const decl of [CREATE_SCHEDULE_DECL, UPDATE_SCHEDULE_DECL]) {
    assert.equal(Object.hasOwn(decl.inputJsonSchema.properties, 'auto_approve'), false);
  }

  const { updateScheduleTool } = useFixture(f.deps);
  await updateScheduleTool.handler({ schedule_id: SCHEDULE_ID, title: 'Renamed' }, ctx);
  assert.equal(f.calls.find(([name]) => name === 'update')[1].autoApprove, false);
});

test("a teammate's shared schedule is listed but cannot be paused, changed or deleted", async () => {
  const f = fixture();
  const shared = {
    ...f.getItem(),
    id: 'shared',
    createdByUserId: 'user-b',
    visibility: 'workspace',
  };
  const hidden = { ...shared, id: 'hidden', visibility: 'private' };
  const all = [f.getItem(), shared, hidden];
  f.deps.listScheduledItems = async () => ({ upcoming: all });
  f.deps.getScheduleAccess = async ({ taskId }) => all.find((task) => task.id === taskId) ?? null;
  const { listSchedulesTool, updateScheduleTool, deleteScheduleTool } = useFixture(f.deps);
  const listed = await listSchedulesTool.handler({}, ctx);
  assert.deepEqual(
    listed.schedules.map((schedule) => schedule.schedule_id),
    [SCHEDULE_ID, 'shared'],
  );

  f.deps.getScheduleAccess = async () => ({ ...shared, id: SCHEDULE_ID });
  await assert.rejects(
    updateScheduleTool.handler({ schedule_id: SCHEDULE_ID, paused: true }, ctx),
    { code: 'TASK_NOT_FOUND' },
  );
  await assert.rejects(
    deleteScheduleTool.handler({ schedule_id: SCHEDULE_ID, title: 'Monday pipeline review' }, ctx),
    { code: 'TASK_NOT_FOUND' },
  );
  assert.equal(
    f.calls.some(([name]) => ['update', 'pause', 'delete'].includes(name)),
    false,
  );
});

test('deleting a schedule always waits for a person to approve it', () => {
  const { deleteScheduleTool } = useFixture(fixture().deps);
  assert.equal(deleteScheduleTool.alwaysAsk, true);
});
