// Unrecognized builder shapes use the long schedule description without its Repeat prefix.

import type { TimeFormat } from '@/lib/format/display-format';
import { formatWallClock } from '@/lib/format/format-date';
import { parseCron } from './build-cron';
import { describeCronSchedule } from './describe-schedule';
import { ordinal } from './ordinal';

const DAY_PLURALS = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];
const WEEKDAYS = '1,2,3,4,5';

export function shortCadence(cron: string, timeFormat: TimeFormat): string {
  const state = parseCron(cron);
  const time = state ? formatWallClock(state.time, timeFormat) : null;
  if (state && time) {
    if (state.repeats === 'daily') return `Daily at ${time}`;
    if (state.repeats === 'weekly') {
      const days = [...state.weekdays].sort((a, b) => a - b);
      if (days.join(',') === WEEKDAYS) return `Weekdays at ${time}`;
      const day = days.at(0);
      const single =
        days.length === 1 && day !== undefined ? DAY_PLURALS[day === 7 ? 0 : day] : undefined;
      if (single) return `${single} at ${time}`;
    }
    const monthDay = state.monthDays.at(0);
    if (state.repeats === 'monthly' && state.monthDays.length === 1 && monthDay !== undefined) {
      return `Monthly on the ${ordinal(monthDay)} at ${time}`;
    }
  }
  const long = describeCronSchedule(cron, timeFormat).replace(/^Repeat /, '');
  return long.charAt(0).toUpperCase() + long.slice(1);
}
