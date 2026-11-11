import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { session, usageEvent, workspaceMember } from '@/db/schema';
import 'server-only';
import { memberCreditPeriodStart, memberLimitExceeded } from '../lib/credit-grants';
import { type WorkspacePlan } from '../pricing-config';
import { type BillingTx } from './credit-ledger';
import { readDatabaseClock } from './ledger-lock';

type MemberCreditUsageInput = {
  organizationId: string;
  workspaceId: string;
  userId: string;
  planTier: WorkspacePlan;
  creditResetAt: Date | null;
};

// The usage event is inserted before this check, so used already includes the candidate charge.
export async function memberCreditLimitExceeded(
  tx: BillingTx,
  input: MemberCreditUsageInput,
): Promise<boolean> {
  const usage = await loadMemberCreditUsage(tx, input, { forUpdate: true });
  return memberLimitExceeded(usage.used, usage.creditLimit);
}

/** The member's spend this period and their limit; the period is decided on the database clock. */
export async function loadMemberCreditUsage(
  tx: BillingTx,
  input: MemberCreditUsageInput,
  { forUpdate }: { forUpdate: boolean },
): Promise<{ used: number; creditLimit: number | null }> {
  const membershipQuery = tx
    .select({ creditLimit: workspaceMember.creditLimit })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.organizationId, input.organizationId),
        eq(workspaceMember.userId, input.userId),
      ),
    );
  const membership = (forUpdate ? await membershipQuery.for('update') : await membershipQuery).at(
    0,
  );
  if (membership?.creditLimit == null) return { used: 0, creditLimit: null };

  const periodStart = memberCreditPeriodStart({
    planTier: input.planTier,
    creditResetAt: input.creditResetAt,
    now: await readDatabaseClock(tx),
  });
  const usage = (
    await tx
      .select({ used: sql<number>`coalesce(sum(-${usageEvent.creditsDelta}), 0)::int` })
      .from(usageEvent)
      .leftJoin(session, eq(session.id, usageEvent.sessionId))
      .where(
        and(
          eq(usageEvent.workspaceId, input.workspaceId),
          sql`coalesce(${usageEvent.userId}, ${session.createdByUserId}) = ${input.userId}`,
          lt(usageEvent.creditsDelta, 0),
          gte(usageEvent.createdAt, periodStart),
        ),
      )
  ).at(0);
  return { used: usage?.used ?? 0, creditLimit: membership.creditLimit };
}
