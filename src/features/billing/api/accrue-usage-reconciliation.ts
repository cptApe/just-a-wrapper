import { db } from '@/db';
import 'server-only';
import { type ModelTokenUsage, modelRequestCents } from '../lib/credit-math';
import { roundVendorCents } from '../lib/round-vendor-cents';
import { usageReconciliationDelta } from '../lib/usage-reconciliation-delta';
import { type AccrualResult } from './accrual-result';
import { accrue } from './accrue';
import { accrueSessionEnd } from './accrue-session-end';
import { loadRecordedUsage } from './load-recorded-usage';
import { recordSessionUsage } from './record-session-usage';
import { lockSessionTotals } from './record-usage';

// The provider's cumulative list cost is authoritative for model and runtime. The part not yet
// recorded joins the session total, and the session's one charging rule bills it.
export async function accrueUsageReconciliation(input: {
  anthropicSessionId: string;
  anthropicEventId: string;
  snapshot: ModelTokenUsage;
  listCostMinorUnits: number | null;
  activeSeconds: number;
}): Promise<AccrualResult> {
  // Provider list cost includes runtime; record its high-water mark before subtracting previously recorded cost.
  if (input.listCostMinorUnits !== null) {
    await accrueSessionEnd(input.anthropicSessionId, {
      anthropicEventId: `reconcile-runtime:${input.anthropicEventId}`,
      runtime: { kind: 'snapshot', activeSeconds: input.activeSeconds },
    });
  }
  return accrue(
    { anthropicSessionId: input.anthropicSessionId, kind: 'usage_reconciliation' },
    input.anthropicEventId,
    (target) =>
      db.transaction(async (tx) => {
        if (!(await lockSessionTotals(tx, target.rowId))) return null;
        const recorded = await loadRecordedUsage(tx, target.rowId, 'model-and-runtime');
        // Process snapshots in observed order, using cumulative cost as a high-water mark rather than event timestamps.
        const usage = usageReconciliationDelta(input.snapshot, recorded.usage);
        const vendorCostCents = roundVendorCents(
          input.listCostMinorUnits === null
            ? modelRequestCents(target.tier, usage)
            : Math.max(0, input.listCostMinorUnits - recorded.vendorCents),
        );
        const hasTokenDelta = Object.values(usage).some((tokens) => tokens > 0);
        if (!hasTokenDelta && vendorCostCents === 0) return null;
        return recordSessionUsage(tx, target, {
          vendorCostCents,
          eventType: 'model_request',
          eventId: input.anthropicEventId,
          usage,
        });
      }),
  );
}
