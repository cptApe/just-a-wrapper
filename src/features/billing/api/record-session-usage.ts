import 'server-only';
import { applyCreditCharge, type ChargeResult } from './apply-credit-charge';
import type { BillingTx } from './credit-ledger';
import type { BillableSession } from './load-billable-session';
import { recordUsage, type UsageCost } from './record-usage';

// Read-aloud passes the listener as the payer; everything else counts against the session creator.
export async function recordSessionUsage(
  tx: BillingTx,
  target: BillableSession,
  cost: UsageCost,
  userId: string = target.createdByUserId,
): Promise<{ credits: number; charge: ChargeResult | null } | null> {
  const recorded = await recordUsage(
    tx,
    {
      workspaceId: target.workspaceId,
      userId,
      platformPaid: target.platformPaid,
      sessionRowId: target.rowId,
    },
    cost,
  );
  if (!recorded) return null;
  const charge =
    recorded.credits > 0 || target.platformPaid
      ? await applyCreditCharge(tx, target, recorded.credits, cost)
      : null;
  return { credits: recorded.credits, charge };
}
