import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { workspace } from './workspace';

// Durable claim for automatic top-ups. Open and succeeded rows reserve monthly cap room,
// so concurrent low-balance events cannot overspend. creating: claimed, no card chosen.
// charging: card frozen, the payment may be in flight. pending: Stripe returned the payment.
export type AutoTopupStatus =
  | 'creating'
  | 'charging'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'superseded';
export const AUTO_TOPUP_OPEN_STATUSES = ['creating', 'charging', 'pending'] as const;

export const autoTopupAttempt = pgTable(
  'auto_topup_attempt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    status: text('status').$type<AutoTopupStatus>().notNull().default('creating'),
    credits: integer('credits').notNull(),
    amountCents: integer('amount_cents').notNull(),
    paymentMethodId: text('payment_method_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'auto_topup_attempt_intent_state_check',
      sql`(${t.status} not in ('pending', 'succeeded') or ${t.stripePaymentIntentId} is not null) and (${t.status} <> 'superseded' or ${t.stripePaymentIntentId} is null)`,
    ),
    check(
      'auto_topup_attempt_card_state_check',
      sql`(${t.status} <> 'creating' or ${t.paymentMethodId} is null) and (${t.status} <> 'charging' or ${t.paymentMethodId} is not null)`,
    ),
    index('auto_topup_attempt_workspace_created_idx').on(t.workspaceId, t.createdAt),
    uniqueIndex('auto_topup_attempt_one_open_uidx')
      .on(t.workspaceId)
      .where(sql`${t.status} in ('creating', 'charging', 'pending')`),
    uniqueIndex('auto_topup_attempt_payment_intent_uidx')
      .on(t.stripePaymentIntentId)
      .where(sql`${t.stripePaymentIntentId} is not null`),
    check(
      'auto_topup_attempt_status_check',
      sql`${t.status} in ('creating', 'charging', 'pending', 'succeeded', 'failed', 'superseded')`,
    ),
    check('auto_topup_attempt_credits_positive_check', sql`${t.credits} > 0`),
    check('auto_topup_attempt_amount_positive_check', sql`${t.amountCents} > 0`),
  ],
);
