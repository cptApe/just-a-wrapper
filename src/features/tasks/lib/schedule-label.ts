// One labeler for every place that names when a task runs: the Tasks screen and the agent's schedule tools.

import type { TimeFormat } from '@/lib/format/display-format';
import { EVENT_TRIGGER_CATALOG } from '../constants';
import { describeCronSchedule } from './describe-schedule';
import { describeOneOffSchedule } from './one-off-schedule';
import { shortCadence } from './short-cadence';

type ScheduleTiming = {
  triggerType: 'schedule' | 'event';
  cronSchedule: string | null;
  eventType: string | null;
  runAt: Date | null;
  timezone: string | null;
};

/**
 * A person gets the short cadence in their time format ("Daily at 9:00 AM"); the agent gets the
 * fixed long wording its replies are written around. Paused state is left out because the row
 * control already shows it.
 */
export function scheduleLabel(
  timing: ScheduleTiming,
  reader: { kind: 'person'; timeFormat: TimeFormat } | { kind: 'agent' },
): string {
  if (timing.triggerType === 'event') {
    return (
      EVENT_TRIGGER_CATALOG.find((trigger) => trigger.eventType === timing.eventType)?.label ??
      'Runs when the event fires'
    );
  }
  if (timing.runAt && timing.timezone) {
    return describeOneOffSchedule({
      runAt: timing.runAt,
      timezone: timing.timezone,
      now: new Date(),
      ...(reader.kind === 'person' ? { timeFormat: reader.timeFormat } : {}),
    });
  }
  if (!timing.cronSchedule) return 'On a schedule';
  return reader.kind === 'person'
    ? shortCadence(timing.cronSchedule, reader.timeFormat)
    : describeCronSchedule(timing.cronSchedule);
}
