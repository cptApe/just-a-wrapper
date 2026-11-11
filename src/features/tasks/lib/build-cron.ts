// BetaManagedAgentsScheduleParams (deployments.d.ts) accepts five POSIX fields; there is no custom-cron field.
// One-offs use transport cron while runAt remains authoritative.

import { splitCron } from '@/features/tasks/lib/split-cron';

export type Repeats = 'daily' | 'weekly' | 'monthly' | 'hourly' | 'yearly';

/** The builder state a cron expands to — the inverse of {@link buildCron}. */
export type BuilderState = {
  repeats: Repeats;
  time: { hour: number; minute: number };
  weekdays: number[];
  monthDays: number[];
  endHour?: number;
  month?: number;
};

/** cron day-of-week: 0 = Sunday … 6 = Saturday. */
export const WEEKDAYS: ReadonlyArray<{ cron: number; short: string; full: string }> = [
  { cron: 1, short: 'Mon', full: 'Monday' },
  { cron: 2, short: 'Tue', full: 'Tuesday' },
  { cron: 3, short: 'Wed', full: 'Wednesday' },
  { cron: 4, short: 'Thu', full: 'Thursday' },
  { cron: 5, short: 'Fri', full: 'Friday' },
  { cron: 6, short: 'Sat', full: 'Saturday' },
  { cron: 0, short: 'Sun', full: 'Sunday' },
];

const dedupeSort = (nums: number[]): string => [...new Set(nums)].sort((a, b) => a - b).join(',');

/**
 * Build the 5-field cron for the current builder state, or null when the state
 * can't produce a valid schedule (a bad time, or Weekly / Monthly with nothing
 * picked) — the dialog uses null to disable Create.
 */
export function buildCron(state: BuilderState): string | null {
  const { hour, minute } = state.time;
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  )
    return null;

  if (state.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return null;
  if (state.repeats === 'hourly') {
    const end = state.endHour ?? 18;
    if (!Number.isInteger(end) || end < hour || end > 23 || state.weekdays.length === 0)
      return null;
    return `${minute} ${hour}-${end} * * ${dedupeSort(state.weekdays)}`;
  }
  if (state.repeats === 'yearly') {
    const month = state.month ?? 1;
    const day = state.monthDays[0];
    if (
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      !day ||
      !Number.isInteger(day) ||
      day < 1 ||
      day > new Date(2000, month, 0).getDate()
    )
      return null;
    return `${minute} ${hour} ${day} ${month} *`;
  }
  if (state.repeats === 'daily') {
    return `${minute} ${hour} * * *`;
  }
  if (state.repeats === 'weekly') {
    if (state.weekdays.length === 0) return null;
    return `${minute} ${hour} * * ${dedupeSort(state.weekdays)}`;
  }
  // monthly
  if (state.monthDays.length === 0) return null;
  if (state.monthDays.some((d) => !Number.isInteger(d) || d < 1 || d > 31)) return null;
  return `${minute} ${hour} ${dedupeSort(state.monthDays)} * *`;
}

/** Parse a numeric-list cron field ("1,3,5") into numbers, or null if any
    token isn't a plain integer (ranges/steps aren't builder-expressible). */
function parseList(field: string): number[] | null {
  const parts = field.split(',');
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    nums.push(Number(part));
  }
  return nums;
}

/** Expand a supported cron into edit controls. Return null for unrepresentable
 * ranges, steps or jointly constrained day fields so callers can choose defaults. */
export function parseCron(expression: string): BuilderState | null {
  const fields = splitCron(expression);
  if (!fields) return null;
  const [minField, hourField, domField, monthField, dowField] = fields;
  const range = /^(\d+)-(\d+)$/.exec(hourField);
  if (
    range &&
    /^\d+$/.test(minField) &&
    Number(minField) < 60 &&
    domField === '*' &&
    monthField === '*'
  ) {
    return parseHourlyCron(range, minField, dowField);
  }
  if (monthField !== '*')
    return parseYearlyCron(minField, hourField, domField, monthField, dowField);

  if (!/^\d+$/.test(minField) || !/^\d+$/.test(hourField)) return null;
  const minute = Number(minField);
  const hour = Number(hourField);
  if (hour > 23 || minute > 59) return null;
  const time = { hour, minute };

  const domAny = domField === '*';
  const dowAny = dowField === '*';

  // Daily: both day fields open.
  if (domAny && dowAny) {
    return { repeats: 'daily', time, weekdays: [1], monthDays: [1] };
  }
  // Weekly: day-of-week constrained, day-of-month open.
  if (domAny && !dowAny) {
    const weekdays = parseList(dowField);
    if (!weekdays || weekdays.some((d) => d < 0 || d > 7)) return null;
    // cron treats 7 as Sunday too; the builder uses 0.
    return {
      repeats: 'weekly',
      time,
      weekdays: weekdays.map((d) => (d === 7 ? 0 : d)),
      monthDays: [1],
    };
  }
  // Monthly: day-of-month constrained, day-of-week open.
  if (!domAny && dowAny) {
    const monthDays = parseList(domField);
    if (!monthDays || monthDays.some((d) => d < 1 || d > 31)) return null;
    return { repeats: 'monthly', time, weekdays: [1], monthDays };
  }
  // Both constrained — not a shape the builder produces.
  return null;
}

// Unrepresentable stored cron must remain untouched until the user changes a control.
export function isBuilderCron(expression: string): boolean {
  return parseCron(expression) !== null;
}

function parseHourlyCron(
  range: RegExpExecArray,
  minField: string,
  dowField: string,
): BuilderState | null {
  const start = Number(range[1]);
  const end = Number(range[2]);
  const weekdays =
    dowField === '*'
      ? [0, 1, 2, 3, 4, 5, 6]
      : dowField === '1-5'
        ? [1, 2, 3, 4, 5]
        : parseList(dowField);
  if (start > end || end > 23 || !weekdays || weekdays.some((d) => d > 6)) return null;
  return {
    repeats: 'hourly',
    time: { hour: start, minute: Number(minField) },
    endHour: end,
    weekdays,
    monthDays: [1],
  };
}

function parseYearlyCron(
  minField: string,
  hourField: string,
  domField: string,
  monthField: string,
  dowField: string,
): BuilderState | null {
  if (
    ![minField, hourField, domField, monthField].every((v) => /^\d+$/.test(v)) ||
    dowField !== '*'
  )
    return null;
  const state: BuilderState = {
    repeats: 'yearly',
    time: { hour: Number(hourField), minute: Number(minField) },
    month: Number(monthField),
    monthDays: [Number(domField)],
    weekdays: [1],
  };
  return buildCron(state) ? state : null;
}
