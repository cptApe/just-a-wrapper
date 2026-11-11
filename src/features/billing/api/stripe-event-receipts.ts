import { sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '@/db';
import { processedWebhookEvent } from '@/db/schema';
import 'server-only';

// Receipts show operators that Stripe deliveries arrive. They never decide whether money moves:
// grant source references and reversal progress rows make every handler idempotent. The recovery
// job prunes them (jobs/api/prune-webhook-receipts.ts).

export async function recordStripeReceipt(event: Pick<Stripe.Event, 'id' | 'type'>): Promise<void> {
  await db
    .insert(processedWebhookEvent)
    .values({ provider: 'stripe', eventId: event.id, eventType: event.type, payload: null })
    .onConflictDoUpdate({
      target: [processedWebhookEvent.provider, processedWebhookEvent.eventId],
      set: { eventType: event.type, processedAt: sql`now()` },
    });
}
