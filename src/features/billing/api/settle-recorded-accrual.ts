import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { usageEvent } from '@/db/schema';
import { BillingError } from '@/lib/errors';
import { type AccrualResult, NOT_BILLED } from './accrual-result';
import type { ChargeResult } from './apply-credit-charge';
import { deriveWorkspaceCreditBalance } from './credit-ledger';
import { memberCreditLimitExceeded } from './member-credit-usage';
import { settleAccrual as deliverAccrual, type SettlementTarget } from './settle-accrual';
import { completeUsageSettlement } from './usage-settlement-transitions';

async function finishRecordedAccrual(
  target: SettlementTarget,
  credits: number,
  charge: ChargeResult,
): Promise<AccrualResult> {
  const result = await deliverAccrual(target, credits, charge);
  await completeUsageSettlement(charge.eventId);
  return result;
}

// Settle the side effects of a recorded charge, or report a replay that has nothing left to do.
export async function finishOrRecoverAccrual(
  target: SettlementTarget,
  usageKey: string,
  applied: { credits: number; charge: ChargeResult | null } | null,
): Promise<AccrualResult> {
  if (!applied) return recoverRecordedAccrual(target, usageKey);
  if (!applied.charge) return { billed: true, credits: 0, balance: null, paused: false };
  return finishRecordedAccrual(target, applied.credits, applied.charge);
}

// The ledger is already charged. Replay only finishes the work after that transaction.
export async function recoverRecordedAccrual(
  target: SettlementTarget,
  usageKey: string,
): Promise<AccrualResult> {
  const pending = (
    await db
      .select()
      .from(usageEvent)
      .where(and(eq(usageEvent.usageKey, usageKey), eq(usageEvent.settlementStatus, 'pending')))
  ).at(0);
  if (!pending) return NOT_BILLED;
  const charge = await db.transaction(async (tx) => ({
    eventId: usageKey,
    balance: await deriveWorkspaceCreditBalance(tx, target.workspaceId),
    memberLimitExceeded:
      'rowId' in target && pending.eventType !== 'voice_tts'
        ? await memberCreditLimitExceeded(tx, {
            organizationId: target.organizationId,
            workspaceId: target.workspaceId,
            userId: target.createdByUserId,
            planTier: target.planTier,
            creditResetAt: target.creditResetAt,
          })
        : false,
  }));
  if (pending.platformPaid) {
    if (pending.vendorCostCents === null)
      throw new BillingError('UNEXPECTED', 'Platform usage has no recorded vendor cost', {
        usageKey,
      });
    return finishRecordedAccrual(target, 0, {
      ...charge,
      platformCost: {
        eventId: usageKey,
        eventType: pending.eventType,
        vendorCostCents: pending.vendorCostCents,
      },
    });
  }
  return finishRecordedAccrual(target, -pending.creditsDelta, charge);
}
