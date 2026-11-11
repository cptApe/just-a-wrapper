// The schedule form: the cron it saves is the one the person picked, in their zone, and a saved custom cron is never rewritten.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchEditableTask } from '../../src/features/scheduled/api/fetch-editable-task.ts';
import { nextRunFromCron } from '../../src/features/scheduled/lib/next-run-from-cron.ts';
import {
  formatOneTimeInput,
  parseOneTimeInput,
} from '../../src/features/scheduled/lib/one-time-input.ts';
import {
  scheduleFormReducer,
  triggerCron,
  triggerFor,
} from '../../src/features/scheduled/lib/schedule-form-machine.ts';
import { SCHEDULE_TEMPLATES } from '../../src/features/scheduled/lib/templates.ts';
import { EVENT_TRIGGER_CATALOG } from '../../src/features/tasks/constants.ts';
import { buildCron, parseCron } from '../../src/features/tasks/lib/build-cron.ts';

const at = (hour, minute = 0) => ({ hour, minute });

test('each repeat choice saves the cron for the picked days and time, and an incomplete choice saves nothing', () => {
  for (const [state, cron] of [
    [{ repeats: 'daily', time: at(17, 30), weekdays: [], monthDays: [] }, '30 17 * * *'],
    [{ repeats: 'weekly', time: at(8), weekdays: [5, 0, 5, 1], monthDays: [] }, '0 8 * * 0,1,5'],
    [
      { repeats: 'monthly', time: at(8), weekdays: [], monthDays: [31, 5, 31, 1] },
      '0 8 1,5,31 * *',
    ],
    [{ repeats: 'weekly', time: at(8), weekdays: [], monthDays: [] }, null],
    [{ repeats: 'monthly', time: at(8), weekdays: [], monthDays: [32] }, null],
    [{ repeats: 'daily', time: at(25), weekdays: [], monthDays: [] }, null],
    [{ repeats: 'hourly', time: at(18), endHour: 9, weekdays: [1], monthDays: [1] }, null],
  ])
    assert.equal(buildCron(state), cron, JSON.stringify(state));
});

test('opening a saved schedule shows the same schedule it was saved with', () => {
  for (const cron of [
    '0 8 * * *',
    '30 17 * * 1,3,5',
    '0 8 1,5,31 * *',
    '0 9-18 * * 1,2,3,4,5',
    '0 15 5 9 *',
    '0 9 29 2 *',
  ])
    assert.equal(buildCron(parseCron(cron)), cron);
  assert.deepEqual(parseCron('0 9 * * 7').weekdays, [0], 'cron Sunday 7 opens as Sunday');
  for (const cron of ['*/15 8 * * *', '0 8 1 * 1', '0 8 * *', '99 8 * * *', '0 9 31 4 *'])
    assert.equal(parseCron(cron), null, cron);
});

test('a saved cron the form cannot show is kept until the person changes a value', () => {
  const saved = { choice: 'weekly', savedCron: '7,37 8-17 * * 1-5', seed: null };
  const opened = triggerFor('weekly', saved);
  assert.equal(triggerCron(opened), saved.savedCron);
  const once = scheduleFormReducer(opened, { type: 'choose', choice: 'once', origin: saved });
  const back = scheduleFormReducer(once, { type: 'choose', choice: 'weekly', origin: saved });
  assert.equal(triggerCron(back), saved.savedCron);
  const edited = scheduleFormReducer(back, { type: 'edit', values: { time: at(9) } });
  assert.notEqual(triggerCron(edited), saved.savedCron);
});

test('a one-time run is read in the schedule’s zone, whatever the browser zone, and a time DST skips is refused', () => {
  const instant = parseOneTimeInput('2026-09-07T09:00', 'Europe/Vilnius');
  assert.equal(instant.toISOString(), '2026-09-07T06:00:00.000Z');
  assert.equal(formatOneTimeInput(instant, 'Europe/Vilnius'), '2026-09-07T09:00');
  assert.equal(
    parseOneTimeInput('2026-09-07T09:00', 'Asia/Kolkata').toISOString(),
    '2026-09-07T03:30:00.000Z',
  );
  for (const [value, zone] of [
    ['2026-03-29T03:30', 'Europe/Vilnius'],
    ['2026-02-30T09:00', 'UTC'],
    ['', 'UTC'],
  ])
    assert.equal(parseOneTimeInput(value, zone), null, value);
});

test('the next run shown is the next matching time in the schedule’s zone', () => {
  const now = Date.parse('2026-09-06T09:00:00Z'); // Sunday noon in Vilnius
  for (const [cron, next] of [
    ['0 15 * * *', '2026-09-06T12:00:00.000Z'],
    ['0 8 * * *', '2026-09-07T05:00:00.000Z'],
    ['0 9 * * 1', '2026-09-07T06:00:00.000Z'],
    ['0 9 1 * *', '2026-10-01T06:00:00.000Z'],
  ])
    assert.equal(nextRunFromCron(cron, 'Europe/Vilnius', now)?.toISOString(), next, cron);
});

test('every template opens a draft that can be saved', () => {
  const events = new Set(EVENT_TRIGGER_CATALOG.map((event) => event.eventType));
  assert.equal(
    new Set(SCHEDULE_TEMPLATES.map((template) => template.id)).size,
    SCHEDULE_TEMPLATES.length,
  );
  for (const { id, draft } of SCHEDULE_TEMPLATES) {
    assert.notEqual(draft.prompt.trim(), '', id);
    if (draft.mode === 'schedule') assert.notEqual(buildCron(draft.schedule), null, id);
    else assert.equal(events.has(draft.eventType), true, id);
  }
});

test('a task with more attachments than a new task allows can still be opened for editing', async (context) => {
  const attachments = {
    files: Array.from({ length: 21 }, (_, index) => ({
      id: String(index),
      name: '',
      url: '/stored/path',
      mimeType: '',
      sizeBytes: 0,
    })),
    folders: [],
  };
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      task: {
        id: 'task',
        version: 1,
        status: 'upcoming',
        title: 'Client report',
        icon: null,
        description: 'Summarize client messages',
        successCriteria: '',
        triggerType: 'schedule',
        tier: 'default',
        autoApprove: false,
        notification: 'app',
        attachments,
        cron: null,
        runAt: '2030-05-06T08:30:00.000Z',
        timezone: 'UTC',
        toolkit: null,
        eventType: null,
      },
    }),
  );
  const task = await fetchEditableTask('task');
  assert.deepEqual(task.attachments, attachments);
  assert.equal(task.runAt.toISOString(), '2030-05-06T08:30:00.000Z');
});
