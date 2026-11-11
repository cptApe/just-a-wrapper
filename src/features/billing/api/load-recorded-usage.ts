import { eq, sql } from 'drizzle-orm';
import { usageEvent } from '@/db/schema';
import { BillingError } from '@/lib/errors';
import type { ModelTokenUsage } from '../lib/credit-math';
import type { BillingTx } from './credit-ledger';

// The model tokens and vendor cents already recorded for a session. The provider's list cost covers
// model and runtime, so reconciliation against it reads both; span reconciliation reads model only.
export async function loadRecordedUsage(
  tx: BillingTx,
  sessionId: string,
  scope: 'model' | 'model-and-runtime',
): Promise<{ usage: ModelTokenUsage; vendorCents: number }> {
  const withRuntime = scope === 'model-and-runtime';
  const row = (
    await tx
      .select({
        inputTokens: sql<string>`coalesce(sum(${usageEvent.tokensIn}) filter (where ${usageEvent.eventType} = 'model_request'), 0)::bigint`,
        outputTokens: sql<string>`coalesce(sum(${usageEvent.tokensOut}) filter (where ${usageEvent.eventType} = 'model_request'), 0)::bigint`,
        cacheCreationTokens: sql<string>`coalesce(sum(${usageEvent.cacheCreationTokens}) filter (where ${usageEvent.eventType} = 'model_request'), 0)::bigint`,
        cacheReadTokens: sql<string>`coalesce(sum(${usageEvent.cacheReadTokens}) filter (where ${usageEvent.eventType} = 'model_request'), 0)::bigint`,
        vendorCents: sql<string>`coalesce(sum(${usageEvent.vendorCostCents}) filter (where ${usageEvent.eventType} = 'model_request' or (${withRuntime} and ${usageEvent.eventType} = 'container_runtime')), 0)`,
      })
      .from(usageEvent)
      .where(eq(usageEvent.sessionId, sessionId))
  ).at(0);
  if (!row)
    throw new BillingError('UNEXPECTED', 'Usage aggregation returned no row', { sessionId });
  return {
    usage: {
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      cacheCreationTokens: Number(row.cacheCreationTokens),
      cacheReadTokens: Number(row.cacheReadTokens),
    },
    vendorCents: Number(row.vendorCents),
  };
}
