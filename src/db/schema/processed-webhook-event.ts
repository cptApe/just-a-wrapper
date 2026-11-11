import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

// The provider and signed event ID identify one durable delivery receipt. Stripe rows are
// receipts of real Stripe event ids only and keep no payload.
export const processedWebhookEvent = pgTable(
  'processed_webhook_event',
  {
    provider: text('provider').$type<'stripe' | 'composio' | 'anthropic'>().notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload'),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.eventId] }),
    check(
      'processed_webhook_provider_check',
      sql`${t.provider} in ('stripe', 'composio', 'anthropic')`,
    ),
    check(
      'processed_webhook_stripe_receipt_check',
      sql`${t.provider} <> 'stripe' or ${t.payload} is null`,
    ),
  ],
);
