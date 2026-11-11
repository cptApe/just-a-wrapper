import { AppError } from '@/lib/errors';
import type { TimeFormat } from '@/lib/format/display-format';
import { formatClock, formatCompactDate } from '@/lib/format/format-date';
import { isOneOffInWindow } from './is-one-off-in-window';
import { zonedDateParts } from './zoned-date-parts';

/** Match the provider's minute-precision cron transport. */
export function truncateOneOffRunAt(runAt: Date): Date {
  return new Date(Math.floor(runAt.getTime() / (60 * 1000)) * 60 * 1000);
}

/**
 * Translate a one-off instant to the only transport Anthropic deployments
 * currently accept: a date-specific five-field cron. The task row remains the
 * source of truth that this is one-off, and adoption archives the deployment
 * before this annual expression can ever repeat.
 */
export function buildOneOffTransportCron(input: {
  runAt: Date;
  timezone: string;
  now: Date;
  validateInstant: boolean;
}): string {
  const now = input.now;
  const runAt = truncateOneOffRunAt(input.runAt);
  if (Number.isNaN(runAt.getTime())) {
    throw new AppError('TOOL_INPUT_INVALID', 'One-off schedule must be in the future', {
      runAt: 'invalid',
    });
  }
  if (input.validateInstant && !isOneOffInWindow(runAt, now.getTime())) {
    throw new AppError(
      'TOOL_INPUT_INVALID',
      runAt <= now
        ? 'One-off schedule must be in the future'
        : 'One-off schedules must be within the next year',
      { runAt: runAt.toISOString() },
    );
  }
  const run = zonedDateParts(runAt, input.timezone);
  return `${run.minute} ${run.hour} ${run.day} ${run.month} *`;
}

/**
 * "Once, today at 14:05", "Once, Nov 10 at 2:05 PM". A screen passes the reader's time format;
 * the agent's schedule tools pass nothing and get the fixed 24-hour "H:mm" wording.
 */
export function describeOneOffSchedule(input: {
  runAt: Date;
  timezone: string;
  now: Date;
  timeFormat?: TimeFormat;
}): string {
  const now = input.now;
  const run = zonedDateParts(input.runAt, input.timezone);
  const today = zonedDateParts(now, input.timezone);
  const tomorrow = zonedDateParts(new Date(now.getTime() + 24 * 60 * 60 * 1000), input.timezone);
  const isToday = run.year === today.year && run.month === today.month && run.day === today.day;
  const isTomorrow =
    run.year === tomorrow.year && run.month === tomorrow.month && run.day === tomorrow.day;
  const time = input.timeFormat
    ? formatClock(input.runAt, { timeZone: input.timezone, timeFormat: input.timeFormat })
    : `${run.hour}:${String(run.minute).padStart(2, '0')}`;
  if (isToday) return `Once, today at ${time}`;
  if (isTomorrow) return `Once, tomorrow at ${time}`;
  return `Once, ${formatCompactDate(input.runAt, { timeZone: input.timezone, now })} at ${time}`;
}
