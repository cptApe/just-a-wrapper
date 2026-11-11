import { and, asc, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { autoTopupAttempt, session, usageEvent, workspace, workspaceNotDeleted } from '@/db/schema';
import { BillingError } from '@/lib/errors';
import { collectRecoveryFailures } from '@/lib/recover-rows';
import { sweepDeadline } from '@/lib/sweep-deadline';
import { loadBillableSession } from './load-billable-session';
import { finishPendingAutoTopup } from './maybe-auto-topup';
import { reconcileSessionUsage } from './reconcile-session-usage';
import { recoverRecordedAccrual } from './settle-recorded-accrual';
import { drainWorkspaceBudgetSync } from './sync-session-budgets';
import { completeUnloadedUsageSettlement } from './usage-settlement-transitions';

// The tools feature sits above billing, so the jobs caller passes its delivery reconcile in.
export async function reconcilePendingBilling(input: {
  reconcileToolDeliveries: () => Promise<void>;
}): Promise<void> {
  const deadline = sweepDeadline();
  const [budgets, purchases, usage] = await Promise.all([
    db
      .select({ id: workspace.id })
      .from(workspace)
      .where(
        and(
          workspaceNotDeleted,
          or(
            eq(workspace.budgetSyncStatus, 'pending'),
            and(
              eq(workspace.budgetSyncStatus, 'syncing'),
              lte(workspace.budgetSyncLeaseUntil, new Date()),
            ),
          ),
        ),
      )
      .orderBy(asc(workspace.updatedAt), asc(workspace.id))
      .limit(100),
    db
      .select({ workspaceId: autoTopupAttempt.workspaceId })
      .from(autoTopupAttempt)
      .innerJoin(workspace, eq(workspace.id, autoTopupAttempt.workspaceId))
      .where(and(inArray(autoTopupAttempt.status, ['creating', 'pending']), workspaceNotDeleted))
      .orderBy(asc(autoTopupAttempt.createdAt), asc(autoTopupAttempt.id))
      .limit(100),
    db
      .select({
        id: usageEvent.id,
        usageKey: usageEvent.usageKey,
        sessionRowId: usageEvent.sessionId,
        sessionId: session.anthropicSessionId,
        workspaceId: usageEvent.workspaceId,
        organizationId: workspace.organizationId,
        userId: usageEvent.userId,
        platformPaid: usageEvent.platformPaid,
      })
      .from(usageEvent)
      .innerJoin(workspace, eq(workspace.id, usageEvent.workspaceId))
      .leftJoin(session, eq(session.id, usageEvent.sessionId))
      .where(eq(usageEvent.settlementStatus, 'pending'))
      .orderBy(asc(usageEvent.createdAt), asc(usageEvent.id))
      .limit(100),
  ]);
  const work = [
    () => input.reconcileToolDeliveries(),
    ...budgets.map((target) => async () => {
      await drainWorkspaceBudgetSync(target.id);
    }),
    ...purchases.map((attempt) => async () => {
      await finishPendingAutoTopup(attempt.workspaceId);
    }),
    ...usage.map((charge) => async () => {
      await recoverPendingUsage(charge);
    }),
  ];
  // One unavailable workspace cannot prevent unrelated paid purchases or usage from recovering.
  const failures = await collectRecoveryFailures(work, (run) => run(), {
    deadline,
    concurrency: 5,
  });
  // Session replay follows durable recovery and rotates attempted rows across daily sweeps.
  const sweepStartedAt = new Date();
  while (Date.now() < deadline) {
    const [target] = await db
      .select({ id: sql<string>`${session.anthropicSessionId}` })
      .from(session)
      .innerJoin(workspace, eq(workspace.id, session.workspaceId))
      .where(
        and(
          workspaceNotDeleted,
          isNotNull(session.anthropicSessionId),
          sql`(${session.usageReconciledAt} is null or ${session.usageReconciledAt} < ${session.statusChangedAt} or ${session.status} in ('running', 'opening', 'resuming'))`,
          sql`(${session.usageReconcileAttemptedAt} is null or ${session.usageReconcileAttemptedAt} < ${sweepStartedAt})`,
        ),
      )
      .orderBy(sql`${session.usageReconcileAttemptedAt} asc nulls first`, session.id)
      .limit(1);
    if (!target) break;
    const [outcome] = await Promise.allSettled([reconcileSessionUsage(target.id, deadline)]);
    if (outcome.status === 'rejected') failures.push(outcome.reason);
  }
  if (failures.length > 0)
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Pending billing outcomes could not all be reconciled',
      { failures: failures.length },
      { cause: new AggregateError(failures) },
    );
}

async function recoverPendingUsage(charge: {
  id: string;
  usageKey: string | null;
  sessionRowId: string | null;
  sessionId: string | null;
  workspaceId: string;
  organizationId: string;
  userId: string | null;
  platformPaid: boolean;
}): Promise<void> {
  // The pending CHECK guarantees a usage key; a sessionless row settles against its workspace.
  if (charge.usageKey !== null && charge.sessionRowId === null && charge.userId !== null) {
    await recoverRecordedAccrual(
      {
        workspaceId: charge.workspaceId,
        organizationId: charge.organizationId,
        userId: charge.userId,
        platformPaid: charge.platformPaid,
      },
      charge.usageKey,
    );
    return;
  }
  const target = charge.sessionId === null ? null : await loadBillableSession(charge.sessionId);
  if (target && charge.usageKey !== null) await recoverRecordedAccrual(target, charge.usageKey);
  else await completeUnloadedUsageSettlement(charge.id);
}
