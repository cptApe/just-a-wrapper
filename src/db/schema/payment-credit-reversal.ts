import { sql } from 'drizzle-orm';
import { check, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { creditGrant } from './credit-grant';

// Cumulative removal per purchased grant makes partial refunds and dispute reversals replay-safe.
export const paymentCreditReversal = pgTable(
  'payment_credit_reversal',
  {
    chargeId: text('charge_id').notNull(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => creditGrant.id, { onDelete: 'cascade' }),
    removedCredits: integer('removed_credits').notNull(),
    balanceRemoved: integer('balance_removed').notNull().default(0),
    debtCredits: integer('debt_credits').notNull().default(0),
    revision: integer('revision').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.chargeId, table.grantId] }),
    check(
      'payment_credit_reversal_values_check',
      sql`${table.removedCredits} >= 0 and ${table.revision} > 0 and ${table.balanceRemoved} >= ${table.debtCredits} and ${table.debtCredits} >= 0 and ${table.balanceRemoved} <= ${table.removedCredits}`,
    ),
  ],
);
