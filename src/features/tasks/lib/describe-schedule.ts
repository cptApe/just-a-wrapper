// Unrecognized cron shapes get a neutral label so provider syntax never leaks into the UI.

import { splitCron } from '@/features/tasks/lib/split-cron';
import type { TimeFormat } from '@/lib/format/display-format';
import { formatWallClock } from '@/lib/format/format-date';
import { parseCron } from './build-cron';
import { ordinal } from './ordinal';
import { describeBuilderState } from './schedule-summary';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const CUSTOM_SCHEDULE = 'Custom schedule';

const isInt = (field: string) => /^\d+$/.test(field);

/** cron weekday → short name; cron allows 7 for Sunday. Null = out of range. */
function dayName(day: number): string | null {
  return DAY_NAMES[day === 7 ? 0 : day] ?? null;
}

/** "0,3" / "6" / "1-5" → short day names, or null if any part is unmappable. */
function weekdayList(field: string): string | null {
  const names: string[] = [];
  for (const part of field.split(',')) {
    if (!isInt(part)) return null;
    const name = dayName(Number(part));
    if (!name) return null;
    names.push(name);
  }
  return names.join(', ');
}

/**
 * The schedule in words. A screen passes the reader's time format; the agent's schedule tools
 * pass nothing and get the fixed 12-hour wording their replies are written around.
 */
export function describeCronSchedule(cron: string, timeFormat: TimeFormat = '12h'): string {
  const builder = parseCron(cron);
  if (builder?.repeats === 'hourly')
    return describeBuilderState(builder, timeFormat) ?? CUSTOM_SCHEDULE;
  const fields = splitCron(cron);
  const fallback = CUSTOM_SCHEDULE;
  if (!fields) return fallback;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

  // */N * * * * — every N minutes
  const everyN = /^\*\/(\d+)$/.exec(minute);
  if (everyN && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = Number(everyN[1]);
    return n === 1 ? 'Repeat every minute' : `Repeat every ${n} minutes`;
  }

  if (!isInt(minute)) return fallback;
  const m = Number(minute);

  // M * * * * — hourly
  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return m === 0 ? 'Repeat hourly' : `Repeat hourly at :${String(m).padStart(2, '0')}`;
  }

  // M */N * * * — every N hours
  const everyNHours = /^\*\/(\d+)$/.exec(hour);
  if (everyNHours && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = Number(everyNHours[1]);
    if (n < 1 || n > 23) return fallback;
    const interval = n === 1 ? 'hour' : `${n} hours`;
    return m === 0
      ? `Repeat every ${interval}`
      : `Repeat every ${interval} at :${String(m).padStart(2, '0')}`;
  }

  if (!isInt(hour)) return fallback;
  const time = formatWallClock({ hour: Number(hour), minute: m }, timeFormat);

  return describeCalendarCron({ hour, minute: m, dayOfMonth, month, dayOfWeek, time });
}

function describeCalendarCron({
  hour,
  minute: m,
  dayOfMonth,
  month,
  dayOfWeek,
  time,
}: {
  hour: string;
  minute: number;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
  time: string;
}): string {
  const fallback = CUSTOM_SCHEDULE;
  // M H D M * — yearly
  if (dayOfWeek === '*' && isInt(dayOfMonth) && isInt(month)) {
    const day = Number(dayOfMonth);
    const monthName = MONTH_NAMES[Number(month) - 1];
    if (!monthName || day < 1 || day > 31 || Number(hour) > 23 || m > 59) return fallback;
    return `Every ${day} ${monthName} at ${Number(hour)}:${String(m).padStart(2, '0')}`;
  }

  if (month !== '*') return fallback;

  // M H * * * — daily
  if (dayOfMonth === '*' && dayOfWeek === '*') return `Repeat daily at ${time}`;

  // M H * * <days> — weekdays / weekly
  if (dayOfMonth === '*') {
    if (dayOfWeek === '1-5') return `Repeat weekdays at ${time}`;
    const days = weekdayList(dayOfWeek);
    return days ? `Repeat weekly on ${days} at ${time}` : fallback;
  }

  // M H D * * — monthly
  if (dayOfWeek === '*' && isInt(dayOfMonth)) {
    return `Repeat monthly on the ${ordinal(Number(dayOfMonth))} at ${time}`;
  }

  return fallback;
}
