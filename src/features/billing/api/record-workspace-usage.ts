import 'server-only';
import { roundVendorCents } from '../lib/round-vendor-cents';
import type { ChargeResult } from './apply-credit-charge';
import {
  type BillingTx,
  consumeWorkspaceCredits,
  deriveWorkspaceCreditBalance,
} from './credit-ledger';
import { recordUsage, type UsageCost } from './record-usage';

// Usage that belongs to no session (dictation). It rounds once per event and never pauses a session.
export type WorkspacePayer = {
  workspaceId: string;
  organizationId: string;
  userId: string;
  platformPaid: boolean;
};

export async function recordWorkspaceUsage(
  tx: BillingTx,
  payer: WorkspacePayer,
  cost: UsageCost,
): Promise<{ credits: number; charge: ChargeResult | null } | null> {
  const recorded = await recordUsage(tx, { ...payer, sessionRowId: null }, cost);
  if (!recorded) return null;
  if (payer.platformPaid)
    return {
      credits: 0,
      charge: {
        eventId: cost.eventId,
        balance: await deriveWorkspaceCreditBalance(tx, payer.workspaceId),
        memberLimitExceeded: false,
        platformCost: {
          eventId: cost.eventId,
          eventType: cost.eventType,
          vendorCostCents: roundVendorCents(cost.vendorCostCents),
        },
      },
    };
  if (recorded.credits === 0) return { credits: 0, charge: null };
  const balance = await consumeWorkspaceCredits(tx, {
    workspaceId: payer.workspaceId,
    credits: recorded.credits,
  });
  return {
    credits: recorded.credits,
    charge: { eventId: cost.eventId, balance, memberLimitExceeded: false },
  };
}
