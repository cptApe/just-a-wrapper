import type { task } from '@/db/schema';
import { splitCron } from '@/features/tasks/lib/split-cron';

export type ScheduleState = 'live' | 'running' | 'paused' | 'finished' | 'stale';

export type ScheduleStateInput = {
  status: typeof task.$inferSelect.status;
  cronSchedule: string | null;
  runAt: Date | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ONE_OFF_STALE_GRACE_MS = 15 * 60 * 1000;

/**
 * Stale means a recurring schedule missed its recorded next run and enough
 * time has elapsed for at least one more interval. The common product cadences
 * are exact here; unknown custom crons get a conservative 31-day interval so
 * a briefly delayed provider run is never mislabeled stale.
 */
function scheduleIntervalMs(cron: string): number {
  const fields = splitCron(cron);
  // Malformed stored cron keeps the conservative annual grace period.
  if (!fields) return 366 * DAY_MS;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (month !== '*') return 366 * DAY_MS;
  if (dayOfMonth !== '*') return 31 * DAY_MS;
  if (dayOfWeek !== '*') return 7 * DAY_MS;
  if (hour !== '*') return DAY_MS;
  if (minute === '*') return 60 * 1000;
  const step = /^\*\/(\d+)$/.exec(minute);
  if (step) return Math.max(1, Number(step[1])) * 60 * 1000;
  return 60 * 60 * 1000;
}

export function scheduleState(schedule: ScheduleStateInput, now: Date): ScheduleState {
  if (schedule.status === 'removed' || schedule.status === 'done') return 'finished';
  if (schedule.status === 'paused') return 'paused';
  if (schedule.status === 'running') return 'running';
  if (schedule.runAt) {
    return now.getTime() - schedule.runAt.getTime() > ONE_OFF_STALE_GRACE_MS ? 'stale' : 'live';
  }
  if (schedule.nextRunAt && schedule.nextRunAt > now) return 'live';
  if (
    schedule.lastRunAt === null &&
    schedule.nextRunAt &&
    schedule.cronSchedule &&
    now.getTime() - schedule.nextRunAt.getTime() > scheduleIntervalMs(schedule.cronSchedule)
  ) {
    return 'stale';
  }
  // A recurring provider tick can be late. It remains active until a whole
  // interval has elapsed without its first run, at which point the branch
  // above identifies the never-fired row as stale.
  return 'live';
}

export function partitionScheduleCapacity<T extends ScheduleStateInput>(
  schedules: readonly T[],
  now: Date,
): { live: T[]; stale: T[] } {
  const live: T[] = [];
  const stale: T[] = [];
  for (const schedule of schedules) {
    const state = scheduleState(schedule, now);
    if (state === 'live' || state === 'running') live.push(schedule);
    if (state === 'stale') stale.push(schedule);
  }
  return { live, stale };
}
