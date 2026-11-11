import 'server-only';
import { roundVendorCents } from '../lib/round-vendor-cents';
import { type BillingTx, consumeWorkspaceCredits } from './credit-ledger';
import { type BillableSession } from './load-billable-session';
import { memberCreditLimitExceeded } from './member-credit-usage';

export type AccrualCost = { vendorCostCents: number; eventType: string; eventId: string };

export type ChargeResult = {
  eventId: string;
  balance: number;
  memberLimitExceeded: boolean;
  platformCost?: AccrualCost;
};

export async function applyCreditCharge(
  tx: BillingTx,
  target: BillableSession,
  credits: number,
  cost: AccrualCost,
): Promise<ChargeResult> {
  if (target.platformPaid) {
    return {
      eventId: cost.eventId,
      balance: target.creditBalance,
      memberLimitExceeded: false,
      platformCost: {
        eventId: cost.eventId,
        eventType: cost.eventType,
        vendorCostCents: roundVendorCents(cost.vendorCostCents),
      },
    };
  }
  // The member limit is read before consumeWorkspaceCredits takes the workspace row lock, so
  // concurrent charges can each pass it. A check that must be exact takes the lock first.
  // Read-aloud belongs to its caller; it must not pause the session creator's work for a member limit.
  const limitExceeded =
    cost.eventType === 'voice_tts'
      ? false
      : await memberCreditLimitExceeded(tx, {
          organizationId: target.organizationId,
          workspaceId: target.workspaceId,
          userId: target.createdByUserId,
          planTier: target.planTier,
          creditResetAt: target.creditResetAt,
        });
  const balance = await consumeWorkspaceCredits(tx, {
    workspaceId: target.workspaceId,
    credits,
  });
  return { eventId: cost.eventId, balance, memberLimitExceeded: limitExceeded };
}
