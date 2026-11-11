import { formatDate } from './format-date';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * "Just now", "5m ago", "3h ago", "2d ago", then the date after a week. Whole units round
 * down, so a label never claims more time than has passed. A moment a little ahead of this
 * clock (another machine's clock) reads "Just now".
 */
export function formatRelativeTime(
  value: Date | string | number,
  context: { now: Date | number; timeZone: string },
): string {
  const then = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(then.getTime())) return '';
  const elapsed = Number(context.now) - then.getTime();
  if (elapsed < MINUTE) return 'Just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d ago`;
  return formatDate(then, context.timeZone);
}
