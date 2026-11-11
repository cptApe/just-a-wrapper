// What the server sends the provider for a schedule: a one-off fires at its minute in its own zone, and bad input is refused.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOneOffTransportCron } from '../../src/features/tasks/lib/one-off-schedule.ts';
import { resolveProviderSchedule } from '../../src/features/tasks/lib/resolve-provider-schedule.ts';
import { resolveTaskSchedule } from '../../src/features/tasks/lib/resolve-task-schedule.ts';
import { scheduleState } from '../../src/features/tasks/lib/schedule-state.ts';
import { isFiveFieldCron, isIanaTimezone } from '../../src/features/tasks/lib/validate-schedule.ts';
import { zonedDateParts } from '../../src/features/tasks/lib/zoned-date-parts.ts';

const row = { id: 'task', runAt: null, lastRunAt: null, cronSchedule: '0 8 * * *' };
const input = { taskId: 'task', cron: '0 8 * * *', timezone: 'UTC' };

test('a one-off becomes a provider cron for its local date and minute, seconds dropped', () => {
  const now = new Date('2026-09-03T10:00:00.000Z');
  for (const [runAt, timezone, cron] of [
    [new Date('2026-09-04T09:00:00+03:00'), 'Europe/Vilnius', '0 9 4 9 *'],
    [new Date('2026-09-04T09:17:42.987+03:00'), 'Europe/Vilnius', '17 9 4 9 *'],
  ])
    assert.equal(buildOneOffTransportCron({ runAt, timezone, now, validateInstant: true }), cron);
  assert.deepEqual(
    resolveProviderSchedule({
      now: new Date('2029-12-01T00:00:00Z'),
      cron: undefined,
      runAt: new Date('2030-01-02T08:30:49Z'),
      timezone: 'Europe/Vilnius',
      validateInstant: false,
    }),
    { runAt: new Date('2030-01-02T08:30:00Z'), providerCron: '30 10 2 1 *' },
  );
});

test('the zone’s calendar date and daylight saving decide the local time', () => {
  assert.deepEqual(zonedDateParts(new Date('2030-01-01T23:30:00Z'), 'Europe/Vilnius'), {
    year: 2030,
    month: 1,
    day: 2,
    hour: 1,
    minute: 30,
  });
  assert.equal(zonedDateParts(new Date('2030-07-01T23:30:00Z'), 'Europe/Vilnius').hour, 2);
});

test('a schedule with no time, both kinds of time, a bad cron or zone, or a one-off past the window is refused', () => {
  for (const patch of [
    { cron: undefined },
    { timezone: undefined },
    { timezone: 'Unknown/Zone' },
    { cron: 'bad cron' },
    { runAt: new Date('2090-01-01') },
    { cron: undefined, runAt: new Date('2090-01-01') },
    { cron: undefined, runAt: new Date('2020-01-01') },
  ])
    assert.throws(() => resolveTaskSchedule({ ...input, ...patch }, row), {
      code: 'TOOL_INPUT_INVALID',
    });
});

test('an unchanged past one-off can still be edited until it runs, and a changed one is minute-aligned', () => {
  const runAt = new Date('2020-03-04T08:30:00Z');
  assert.deepEqual(
    resolveTaskSchedule(
      { ...input, cron: undefined, runAt },
      { ...row, runAt, cronSchedule: null },
    ),
    { runAt, providerCron: '30 8 4 3 *', timezone: 'UTC' },
  );
  const changed = resolveTaskSchedule(
    { ...input, cron: undefined, runAt: new Date(Date.now() + 86400000) },
    row,
  );
  assert.equal(changed.runAt.getTime() % 60000, 0);
});

test('zones browsers report, including old aliases, are accepted and made-up ones are not', () => {
  for (const zone of [
    'UTC',
    'Europe/Vilnius',
    'Asia/Kolkata',
    'Europe/Kyiv',
    'America/Argentina/Buenos_Aires',
  ])
    assert.equal(isIanaTimezone(zone), true, zone);
  for (const zone of ['', 'EST5EDT-nonsense', 'Mars/Olympus_Mons', 'GMT+3'])
    assert.equal(isIanaTimezone(zone), false, zone);
  for (const cron of ['*/5 * * * *', '0 9 * * 1-5', '0,30 9-17 * * 0'])
    assert.equal(isFiveFieldCron(cron), true, cron);
  for (const cron of ['', '* * * *', '* * * * * *', '@daily', '0 9 * * MON'])
    assert.equal(isFiveFieldCron(cron), false, cron);
});

test('a missed one-off stays live for its 15-minute pickup grace, then turns stale', () => {
  const oneOff = {
    title: 'Once',
    status: 'upcoming',
    cronSchedule: null,
    runAt: new Date('2026-09-03T11:45:00.000Z'),
    nextRunAt: new Date('2026-09-03T11:45:00.000Z'),
    lastRunAt: null,
  };
  assert.equal(scheduleState(oneOff, new Date('2026-09-03T12:00:00.000Z')), 'live');
  assert.equal(scheduleState(oneOff, new Date('2026-09-03T12:00:00.001Z')), 'stale');
  const running = { ...oneOff, status: 'running', lastRunAt: oneOff.runAt };
  assert.equal(scheduleState(running, new Date('2026-09-04T00:00:00Z')), 'running');
  assert.equal(
    scheduleState(
      { ...running, status: 'done', nextRunAt: null },
      new Date('2026-09-04T00:00:00Z'),
    ),
    'finished',
  );
});
