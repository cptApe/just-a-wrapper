import { db } from '@/db';
import 'server-only';
import { type BillableTier, type ModelTokenUsage, modelRequestCents } from '../lib/credit-math';
import { type AccrualResult } from './accrual-result';
import { accrue } from './accrue';
import { recordSessionUsage } from './record-session-usage';

// Naming a chat is the platform's cost, never the customer's: the row records its exact vendor
// cost with zero credits and emits the same platform-cost telemetry as billing-off usage.
export async function accrueTitleGeneration(input: {
  anthropicSessionId: string;
  responseId: string;
  pricingTier: BillableTier;
  usage: ModelTokenUsage;
}): Promise<AccrualResult> {
  const usageKey = `title:${input.responseId}`;
  return accrue(
    { anthropicSessionId: input.anthropicSessionId, kind: 'title_generation', platformPaid: true },
    usageKey,
    (target) =>
      db.transaction((tx) =>
        recordSessionUsage(tx, target, {
          eventType: 'title_generation',
          eventId: usageKey,
          vendorCostCents: modelRequestCents(input.pricingTier, input.usage),
          usage: input.usage,
        }),
      ),
  );
}
