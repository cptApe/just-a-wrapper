import type { WorkspacePlan } from '../pricing-config';
import { expiresAtMonthsAfter } from '../pricing-config';

export type ConsumableGrant = {
  id: string;
  amount: number;
  consumed: number;
  expiresAt: Date;
  issuedAt: Date;
};

export type GrantConsumption = { id: string; credits: number };

function startOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

// Paid workspaces use their billing anniversary; workspaces without a plan use the calendar month.
export function memberCreditPeriodStart(input: {
  planTier: WorkspacePlan;
  creditResetAt: Date | null;
  now: Date;
}): Date {
  if (input.planTier === 'none' || input.creditResetAt === null) return startOfUtcMonth(input.now);
  const anchor = input.creditResetAt;
  let months =
    (input.now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    input.now.getUTCMonth() -
    anchor.getUTCMonth();
  let start = expiresAtMonthsAfter(anchor, months);
  if (start > input.now) start = expiresAtMonthsAfter(anchor, --months);
  return start;
}

export function memberLimitExceeded(usedIncludingAttempt: number, limit: number | null): boolean {
  return limit !== null && usedIncludingAttempt > limit;
}

// Spend soonest-expiring credit first; issue date and ID make tied grants deterministic.
export function allocateGrantConsumption(
  grants: readonly ConsumableGrant[],
  credits: number,
): GrantConsumption[] {
  let remaining = Math.max(0, credits);
  const allocations: GrantConsumption[] = [];
  const ordered = [...grants].sort(
    (a, b) =>
      a.expiresAt.getTime() - b.expiresAt.getTime() ||
      a.issuedAt.getTime() - b.issuedAt.getTime() ||
      a.id.localeCompare(b.id),
  );

  for (const grant of ordered) {
    if (remaining === 0) break;
    const available = Math.max(0, grant.amount - grant.consumed);
    const applied = Math.min(available, remaining);
    if (applied > 0) allocations.push({ id: grant.id, credits: applied });
    remaining -= applied;
  }
  return allocations;
}
