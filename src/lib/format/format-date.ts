import { type DisplayFormat, FORMAT_LOCALE, type TimeFormat } from './display-format';

// Instants (a moment in time) are shown in the reader's zone. Calendar days and wall-clock
// times (a schedule's "9:00", a picked date) have no zone and are shown as they are.

type DateInput = Date | string | number;

/** A day on the calendar, month 1 to 12, or its "YYYY-MM-DD" key. */
export type CalendarDay = { year: number; month: number; day: number };
type CalendarDayInput = CalendarDay | string;

/** A wall-clock time with no zone, hour 0 to 23. */
type WallClock = { hour: number; minute: number };

const INVALID = '—';
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(options: Intl.DateTimeFormatOptions & { timeZone: string }) {
  const key = JSON.stringify(options);
  const cached = formatters.get(key);
  if (cached) return cached;
  let created: Intl.DateTimeFormat;
  try {
    created = new Intl.DateTimeFormat(FORMAT_LOCALE, options);
  } catch (error) {
    // An unknown zone is bad input: show UTC rather than the runtime's own zone.
    if (!(error instanceof RangeError)) throw error;
    created = new Intl.DateTimeFormat(FORMAT_LOCALE, { ...options, timeZone: 'UTC' });
  }
  formatters.set(key, created);
  return created;
}

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hourCycle(timeFormat: TimeFormat) {
  return timeFormat === '24h' ? ('h23' as const) : ('h12' as const);
}

function clockOptions(timeZone: string, timeFormat: TimeFormat) {
  return {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: hourCycle(timeFormat),
  } as const;
}

/** "Nov 10, 2026" */
export function formatDate(value: DateInput, timeZone: string): string {
  const date = toDate(value);
  if (!date) return INVALID;
  return formatter({ timeZone, month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

/** "Nov 10": the year left out where space is tight and the year is plain from context. */
export function formatShortDate(value: DateInput, timeZone: string): string {
  const date = toDate(value);
  if (!date) return INVALID;
  return formatter({ timeZone, month: 'short', day: 'numeric' }).format(date);
}

/** "Nov 10" in the current year, "Nov 10, 2025" otherwise, both judged in the reader zone. */
export function formatCompactDate(
  value: DateInput,
  context: { timeZone: string; now?: Date | number },
): string {
  const date = toDate(value);
  if (!date) return INVALID;
  const year = formatter({ timeZone: context.timeZone, year: 'numeric' });
  return year.format(date) === year.format(new Date(context.now ?? Date.now()))
    ? formatShortDate(date, context.timeZone)
    : formatDate(date, context.timeZone);
}

/** "Tuesday, November 10, 2026": for screen readers and the agent's own clock line. */
export function formatLongDate(value: DateInput, timeZone: string): string {
  const date = toDate(value);
  if (!date) return INVALID;
  return formatter({
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/** "Nov 10, 2026, 2:05 PM" or "Nov 10, 2026, 14:05" */
export function formatDateTime(value: DateInput, display: DisplayFormat): string {
  const date = toDate(value);
  if (!date) return INVALID;
  return formatter({
    ...clockOptions(display.timeZone, display.timeFormat),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/** "2:05 PM" or "14:05" */
export function formatClock(value: DateInput, display: DisplayFormat): string {
  const date = toDate(value);
  if (!date) return INVALID;
  return formatter(clockOptions(display.timeZone, display.timeFormat)).format(date);
}

/** Calendar chips: "2 PM" on the hour in 12-hour time, otherwise the plain clock. */
export function formatHourClock(value: DateInput, display: DisplayFormat): string {
  const date = toDate(value);
  if (!date) return INVALID;
  const clock = formatter(clockOptions(display.timeZone, display.timeFormat));
  const onTheHour =
    clock.formatToParts(date).find((part) => part.type === 'minute')?.value === '00';
  if (!onTheHour || display.timeFormat === '24h') return clock.format(date);
  return formatter({ timeZone: display.timeZone, hour: 'numeric', hourCycle: 'h12' }).format(date);
}

/** "Nov 10, 2 PM": a date and time on one short line, for narrow rows. */
export function formatCompactDateTime(value: DateInput, display: DisplayFormat): string {
  const date = toDate(value);
  if (!date) return INVALID;
  return `${formatShortDate(date, display.timeZone)}, ${formatHourClock(date, display)}`;
}

/** A zone's offset from UTC right now: "GMT", "GMT+9", "GMT+5:30". */
export function formatZoneOffset(timeZone: string, at: Date = new Date()): string {
  return (
    formatter({ timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  );
}

/** The calendar day an instant falls on in a zone, as a "YYYY-MM-DD" key. Not for display. */
export function zonedDayKey(value: DateInput, timeZone: string): string | null {
  const date = toDate(value);
  if (!date) return null;
  const parts = formatter({
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// Calendar days and wall clocks are placed at that moment in UTC and formatted in UTC, so no
// zone can move them to another day or hour. A malformed day key gives an invalid date ("—").
function utcDay(input: CalendarDayInput): Date {
  const day = typeof input === 'string' ? calendarDayFromKey(input) : input;
  return day ? new Date(Date.UTC(day.year, day.month - 1, day.day, 12)) : new Date(Number.NaN);
}

/** A "YYYY-MM-DD" key as a calendar day; null when the key is not one. */
function calendarDayFromKey(key: string): CalendarDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** "Nov 10, 2026" for a day picked on a calendar. */
export function formatCalendarDate(day: CalendarDayInput): string {
  return formatDate(utcDay(day), 'UTC');
}

/** "Nov 10" for a calendar day whose year is plain from context. */
export function formatCalendarShortDate(day: CalendarDayInput): string {
  return formatShortDate(utcDay(day), 'UTC');
}

/** "Tuesday, Nov 10": a day heading in a list of days. */
export function formatCalendarWeekday(day: CalendarDayInput): string {
  const date = utcDay(day);
  if (Number.isNaN(date.getTime())) return INVALID;
  return formatter({ timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(
    date,
  );
}

/** "Tuesday, November 10, 2026": a calendar cell's accessible name. */
export function formatCalendarLong(day: CalendarDayInput): string {
  return formatLongDate(utcDay(day), 'UTC');
}

/** "Nov" for month 11. */
export function formatMonthName(month: number): string {
  return formatter({ timeZone: 'UTC', month: 'short' }).format(
    utcDay({ year: 2000, month, day: 1 }),
  );
}

/** "Nov 2026" (short) or "November 2026" (long), month 1 to 12. */
export function formatMonth(
  value: { year: number; month: number },
  style: 'short' | 'long',
): string {
  return formatter({ timeZone: 'UTC', month: style, year: 'numeric' }).format(
    utcDay({ ...value, day: 1 }),
  );
}

/** "9:05 AM" or "09:05" for a schedule's wall-clock time. */
export function formatWallClock(time: WallClock, timeFormat: TimeFormat): string {
  return formatClock(new Date(Date.UTC(2000, 0, 1, time.hour, time.minute)), {
    timeZone: 'UTC',
    timeFormat,
  });
}
