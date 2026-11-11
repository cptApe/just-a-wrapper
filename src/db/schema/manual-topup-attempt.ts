import { sql } from 'drizzle-orm';
import { check, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspace } from './workspace';

export type ManualTopupStatus = 'open' | 'processing' | 'succeeded' | 'failed' | 'expired';

// A manual purchase attempt as the server first saw it. The database clock stamps it, so
// whether Stripe still remembers the attempt key never depends on the browser's clock.
export const manualTopupAttempt = pgTable(
  'manual_topup_attempt',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    attemptKey: text('attempt_key').notNull(),
    credits: integer('credits').notNull(),
    status: text('status').$type<ManualTopupStatus>().notNull().default('open'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.attemptKey] }),
    check(
      'manual_topup_attempt_status_check',
      sql`${t.status} in ('open', 'processing', 'succeeded', 'failed', 'expired')`,
    ),
    check(
      'manual_topup_attempt_intent_check',
      sql`${t.status} <> 'processing' or ${t.stripePaymentIntentId} is not null`,
    ),
    check('manual_topup_attempt_credits_positive_check', sql`${t.credits} > 0`),
  ],
);
