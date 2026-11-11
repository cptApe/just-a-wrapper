import { AppError } from '@/lib/errors';
import { buildOneOffTransportCron, truncateOneOffRunAt } from './one-off-schedule';
import { isFiveFieldCron, isIanaTimezone } from './validate-schedule';

export function resolveProviderSchedule(input: {
  cron: string | undefined;
  runAt: Date | undefined;
  timezone: string;
  validateInstant: boolean;
  now: Date;
}) {
  if (input.cron !== undefined && input.runAt !== undefined)
    throw new AppError('TOOL_INPUT_INVALID', 'Provide either cron or run_at, not both.', {});
  if (input.cron !== undefined && !isFiveFieldCron(input.cron))
    throw new AppError(
      'TOOL_INPUT_INVALID',
      'Schedule must be a 5-field cron expression (minute hour day month weekday)',
      { cron: input.cron },
    );
  if (!isIanaTimezone(input.timezone))
    throw new AppError('TOOL_INPUT_INVALID', 'Unknown timezone', { timezone: input.timezone });
  const runAt = input.runAt ? truncateOneOffRunAt(input.runAt) : null;
  if (input.cron !== undefined) return { runAt, providerCron: input.cron };
  if (!runAt)
    throw new AppError('TOOL_INPUT_INVALID', 'A one-off schedule needs a run_at time.', {});
  return {
    runAt,
    providerCron: buildOneOffTransportCron({
      runAt,
      timezone: input.timezone,
      validateInstant: input.validateInstant,
      now: input.now,
    }),
  };
}
