import type { TimeFormat } from '@/lib/format/display-format';
import { formatMonthName, formatWallClock } from '@/lib/format/format-date';
import { type BuilderState, buildCron, WEEKDAYS } from './build-cron';
import { ordinal } from './ordinal';

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WORKWEEK = [1, 2, 3, 4, 5];

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function weekdayPhrase(weekdays: number[]): string | null {
  const picked = WEEKDAY_ORDER.filter((day) => weekdays.includes(day));
  if (picked.length === 0) return null;
  if (picked.length === 7) return 'every day';
  if (picked.length === 5 && WORKWEEK.every((day) => picked.includes(day))) {
    return 'every weekday';
  }
  const names = picked.map((day) => WEEKDAYS.find((w) => w.cron === day)?.full ?? '');
  return `every ${joinList(names)}`;
}

function monthDayPhrase(monthDays: number[]): string | null {
  const picked = [...new Set(monthDays)].filter((d) => d >= 1 && d <= 31).sort((a, b) => a - b);
  if (picked.length === 0) return null;
  return `on the ${joinList(picked.map(ordinal))} of every month`;
}

/**
 * The summary sentence for a builder state, or null when the state can't
 * schedule (no day picked, bad time) — the dialog shows a hint instead.
 */
export function describeBuilderState(state: BuilderState, timeFormat: TimeFormat): string | null {
  if (buildCron(state) === null) return null;
  const time = formatWallClock(state.time, timeFormat);
  if (state.repeats === 'hourly') {
    const days = weekdayPhrase(state.weekdays);
    const end = formatWallClock({ hour: state.endHour ?? 18, minute: 0 }, timeFormat);
    return days ? `Runs hourly ${days}, from ${time} to ${end}` : null;
  }
  if (state.repeats === 'yearly')
    return `Runs every year on ${formatMonthName(state.month ?? 1)} ${state.monthDays[0]} at ${time}`;
  if (state.repeats === 'daily') return `Runs every day at ${time}`;
  if (state.repeats === 'weekly') {
    const days = weekdayPhrase(state.weekdays);
    return days ? `Runs ${days} at ${time}` : null;
  }
  const days = monthDayPhrase(state.monthDays);
  return days ? `Runs ${days} at ${time}` : null;
}

/** "Runs …" → "Runs … (Europe/Vilnius)", the zone spelled out only when known. */
export function withTimezone(summary: string, timezone: string | null): string {
  return timezone ? `${summary} (${timezone.replace(/_/g, ' ')})` : summary;
}
