import { and, eq, inArray, ne } from 'drizzle-orm';
import { task } from '@/db/schema';
import { lockAndLoadPlan } from '@/features/billing/api/assert-plan-limits';
import type { BillingTx } from '@/features/billing/api/credit-ledger';
import { limitRefusal } from '@/features/billing/api/plan-limits';
import { scheduledTasksExceeded, scheduledTasksMessage } from '@/features/billing/lib/plan-gates';
import { BillingError } from '@/lib/errors';
import 'server-only';
import { partitionScheduleCapacity } from '../lib/schedule-state';

// Scheduled and event-triggered tasks share one pool of slots. Removed rows keep no slot.
export async function assertCanCreateScheduledTask(
  workspaceId: string,
  visibleToUserId: string,
  tx: BillingTx,
): Promise<void> {
  const plan = await lockAndLoadPlan(tx, workspaceId);
  if (plan === null) return;
  const refusal = await limitRefusal(plan);
  const { limits } = refusal;
  const schedules = await tx
    .select({
      title: task.title,
      createdByUserId: task.createdByUserId,
      visibility: task.visibility,
      status: task.status,
      cronSchedule: task.cronSchedule,
      runAt: task.runAt,
      nextRunAt: task.nextRunAt,
      lastRunAt: task.lastRunAt,
    })
    .from(task)
    .where(
      and(
        eq(task.workspaceId, workspaceId),
        inArray(task.triggerType, ['schedule', 'event']),
        ne(task.status, 'removed'),
      ),
    );
  const capacity = partitionScheduleCapacity(schedules, new Date());
  const scheduled = capacity.live.length;
  if (!scheduledTasksExceeded(scheduled, limits)) return;
  const visibleStale = capacity.stale.filter(
    (schedule) =>
      schedule.createdByUserId === visibleToUserId || schedule.visibility === 'workspace',
  );
  throw new BillingError(
    'PLAN_LIMIT_REACHED',
    scheduledTasksMessage(refusal, {
      activeCount: scheduled,
      staleNames: visibleStale.map((schedule) => schedule.title),
    }),
    {
      workspaceId,
      plan,
      scheduled,
      staleSchedules: visibleStale.map((schedule) => schedule.title),
      limit: limits.scheduledTasks,
    },
  );
}
