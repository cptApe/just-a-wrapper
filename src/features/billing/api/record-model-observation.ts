import { eq, sql } from 'drizzle-orm';
import { modelUsageObservation } from '@/db/schema';
import { BillingError } from '@/lib/errors';
import type { ModelTokenUsage } from '../lib/credit-math';
import { roundVendorCents } from '../lib/round-vendor-cents';
import { usageReconciliationDelta } from '../lib/usage-reconciliation-delta';
import type { BillingTx } from './credit-ledger';
import { loadRecordedUsage } from './load-recorded-usage';

// A span can arrive after a snapshot already billed its tokens. Comparing every observed span with
// what was recorded charges only the part no snapshot covered. Run under the session lock.
// Returns null when this span was already observed.
export async function recordModelObservation(
  tx: BillingTx,
  input: typeof modelUsageObservation.$inferInsert,
): Promise<{ vendorCostCents: number; usage: ModelTokenUsage } | null> {
  const inserted = await tx
    .insert(modelUsageObservation)
    .values(input)
    .onConflictDoNothing()
    .returning({ id: modelUsageObservation.eventId });
  if (inserted.length === 0) return null;
  const [observed] = await tx
    .select({
      inputTokens: sql<number>`coalesce(sum(${modelUsageObservation.inputTokens}), 0)`.mapWith(
        Number,
      ),
      outputTokens: sql<number>`coalesce(sum(${modelUsageObservation.outputTokens}), 0)`.mapWith(
        Number,
      ),
      cacheCreationTokens:
        sql<number>`coalesce(sum(${modelUsageObservation.cacheCreationTokens}), 0)`.mapWith(Number),
      cacheReadTokens:
        sql<number>`coalesce(sum(${modelUsageObservation.cacheReadTokens}), 0)`.mapWith(Number),
      vendorCostCents:
        sql<number>`coalesce(sum(${modelUsageObservation.vendorCostCents}), 0)`.mapWith(Number),
    })
    .from(modelUsageObservation)
    .where(eq(modelUsageObservation.sessionId, input.sessionId));
  if (!observed)
    throw new BillingError('UNEXPECTED', 'Model observations returned no aggregate', {
      sessionId: input.sessionId,
    });
  const recorded = await loadRecordedUsage(tx, input.sessionId, 'model');
  return {
    vendorCostCents: roundVendorCents(Math.max(0, observed.vendorCostCents - recorded.vendorCents)),
    usage: usageReconciliationDelta(observed, recorded.usage),
  };
}
