import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { processedWebhookEvent } from '@/db/schema';

// Providers redeliver within days, so a receipt older than this can no longer stop a duplicate.
const RECEIPT_RETENTION = sql`interval '90 days'`;

// One retention rule per provider for the shared receipt table:
// - Stripe keeps its newest receipt so the admin page can say when Stripe last delivered.
// - Composio keeps deliveries that are not finished, because the task sweeps still read them.
// - Anthropic receipts only deduplicate webhooks.
export async function pruneWebhookReceipts(): Promise<number> {
  const removed = await db
    .delete(processedWebhookEvent)
    .where(
      sql`${processedWebhookEvent.processedAt} < now() - ${RECEIPT_RETENTION} and (
        (${processedWebhookEvent.provider} = 'stripe' and ${processedWebhookEvent.processedAt} < (
          select max(latest.processed_at) from ${processedWebhookEvent} latest
          where latest.provider = 'stripe'))
        or (${processedWebhookEvent.provider} = 'composio'
          and ${processedWebhookEvent.payload}->>'state' in ('completed', 'failed', 'skipped'))
        or ${processedWebhookEvent.provider} = 'anthropic')`,
    )
    .returning({ eventId: processedWebhookEvent.eventId });
  return removed.length;
}
