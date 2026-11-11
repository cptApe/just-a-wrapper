// Pure month-grid math for the calendar view, hand-rolled on native Date —
// the repo carries no date library and a Monday-first month grid doesn't
// justify adding one.

import { type CalendarDay, formatMonth } from '@/lib/format/format-date';

export type MonthGridDay = {
  date: Date;
  /** Local-date key 'YYYY-MM-DD' — matches `dateKey()` of an item's occurredAt. */
  key: string;
  inMonth: boolean;
};

export type MonthCursor = { year: number; month: number };

export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Monday-first weeks fully covering the given month (leading/trailing days included). */
export function buildMonthGrid(year: number, month: number): MonthGridDay[][] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((lead + daysInMonth) / 7) * 7;

  const days: MonthGridDay[] = [];
  for (let i = 0; i < cellCount; i += 1) {
    const date = new Date(year, month, i - lead + 1);
    days.push({ date, key: dateKey(date), inMonth: date.getMonth() === month });
  }

  const weeks: MonthGridDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

export function shiftMonth(cursor: MonthCursor, delta: 1 | -1): MonthCursor {
  const shifted = new Date(cursor.year, cursor.month + delta, 1);
  return { year: shifted.getFullYear(), month: shifted.getMonth() };
}

/** The grid's local day as a calendar day, so labels never shift with a zone. */
export function toCalendarDay(date: Date): CalendarDay {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

export function monthLabel(cursor: MonthCursor, format: 'short' | 'long'): string {
  return formatMonth({ year: cursor.year, month: cursor.month + 1 }, format);
}
