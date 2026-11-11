import { pluralNoun } from '@/lib/format/plural';
import type { PlanLimits } from '../pricing-config';

export const UNLIMITED_MEMBERS = 1_000_000;

export function chatsAtOnceExceeded(runningCount: number, limits: PlanLimits): boolean {
  return runningCount >= limits.chatsAtOnce;
}

export function scheduledTasksExceeded(existingCount: number, limits: PlanLimits): boolean {
  return existingCount >= limits.scheduledTasks;
}

export function membersAllowed(limits: PlanLimits): number {
  return limits.members ?? UNLIMITED_MEMBERS;
}

export function membersExceeded(
  memberCount: number,
  pendingInvitationCount: number,
  limits: PlanLimits,
): boolean {
  if (limits.members === null) return false;
  return memberCount + pendingInvitationCount >= limits.members;
}

/** Whether a refusal may point at a bigger plan: true only where plans are sold. */
export type LimitRefusal = { limits: PlanLimits; biggerPlan: boolean };

const BIGGER_PLAN_HINT = ' A bigger plan raises this limit.';

export function chatsAtOnceMessage({ limits, biggerPlan }: LimitRefusal): string {
  const limit = limits.chatsAtOnce;
  return `This workspace can run ${limit} ${pluralNoun(limit, 'chat')} at once. Wait for one to finish.${biggerPlan ? BIGGER_PLAN_HINT : ''}`;
}

export function scheduledTasksMessage(
  { limits, biggerPlan }: LimitRefusal,
  detail?: { activeCount: number; staleNames: readonly string[] },
): string {
  const staleSuffix =
    detail && detail.staleNames.length > 0
      ? ` These stale schedules do not count toward the limit: ${detail.staleNames
          .map((name) => `“${name}”`)
          .join(', ')}. Delete them to clean up the list.`
      : '';
  const limit = limits.scheduledTasks;
  const count = detail ? ` You have ${detail.activeCount} active schedules.` : '';
  const hint = biggerPlan ? BIGGER_PLAN_HINT : '';
  if (limit === 0) return `This workspace cannot have schedules.${count}${hint}${staleSuffix}`;
  return `This workspace can have ${limit} active ${pluralNoun(limit, 'schedule')}.${count} Delete one to add another.${hint}${staleSuffix}`;
}

export function membersMessage({ limits, biggerPlan }: LimitRefusal): string {
  const limit = limits.members;
  if (limit === null) return 'This workspace has no limit on team members.';
  return `This workspace can have ${limit} team ${pluralNoun(limit, 'member')}.${biggerPlan ? BIGGER_PLAN_HINT : ''}`;
}
