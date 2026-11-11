import type { task } from '@/db/schema';
import { AppError } from '@/lib/errors';
import type { UpdateTaskInput } from '../types';
import { truncateOneOffRunAt } from './one-off-schedule';
import { resolveProviderSchedule } from './resolve-provider-schedule';

export type ResolvedSchedule = {
  runAt: Date | null;
  providerCron: string;
  timezone: string;
};

export function resolveTaskSchedule(
  input: UpdateTaskInput,
  row: Pick<typeof task.$inferSelect, 'id' | 'runAt'>,
): ResolvedSchedule {
  if (
    (input.cron === undefined && input.runAt === undefined) ||
    input.timezone === undefined ||
    input.timezone === null
  ) {
    throw new AppError('TOOL_INPUT_INVALID', 'A schedule needs a time and timezone', {
      taskId: row.id,
    });
  }
  const runAt = input.runAt ? truncateOneOffRunAt(input.runAt) : null;
  const runAtChanged = input.runAt !== undefined && runAt?.getTime() !== row.runAt?.getTime();
  const { providerCron } = resolveProviderSchedule({
    now: new Date(),
    cron: input.cron,
    runAt: input.runAt,
    timezone: input.timezone,
    validateInstant: runAtChanged,
  });

  return { runAt, providerCron, timezone: input.timezone };
}
