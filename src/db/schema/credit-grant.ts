import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { workspace } from './workspace';

export type CreditGrantSource = 'plan' | 'topup' | 'welcome' | 'debt';
// usage: spending beyond the balance. hold: debt a future plan bucket repaid early, owed until the
// bucket starts. refund: purchased credits already spent when the payment was reversed.
// restored: a hold put back as debt when its future bucket was retired.
export type CreditDebtKind = 'usage' | 'hold' | 'refund' | 'restored';

// Expiring credit buckets are the accounting source of truth.
export const creditGrant = pgTable(
  'credit_grant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    source: text('source').$type<CreditGrantSource>().notNull(),
    status: text('status').$type<'issued' | 'retired'>().notNull().default('issued'),
    amount: integer('amount').notNull(),
    // A debt row of size d is written with consumed = 2d so the balance stays one sum of
    // amount - consumed; repaying lowers consumed toward amount.
    consumed: integer('consumed').notNull().default(0),
    // The idempotency key of the issuance, unique per workspace so every path can be retried.
    sourceRef: text('source_ref').notNull(),
    debtKind: text('debt_kind').$type<CreditDebtKind>(),
    // The grant this row derives from: a hold's future bucket, a refund debt's or a refund
    // remainder's purchase, a restored debt's hold, a restored-debt credit's refund debt.
    parentGrantId: uuid('parent_grant_id').references((): AnyPgColumn => creditGrant.id, {
      onDelete: 'cascade',
    }),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check('credit_grant_status_check', sql`${t.status} in ('issued', 'retired')`),
    uniqueIndex('credit_grant_workspace_source_ref_uidx').on(t.workspaceId, t.sourceRef),
    index('credit_grant_workspace_expiry_idx').on(t.workspaceId, t.expiresAt, t.issuedAt),
    index('credit_grant_parent_idx').on(t.parentGrantId).where(sql`${t.parentGrantId} is not null`),
    check('credit_grant_source_check', sql`${t.source} in ('plan', 'topup', 'welcome', 'debt')`),
    check('credit_grant_amount_positive_check', sql`${t.amount} > 0`),
    check(
      'credit_grant_consumed_range_check',
      sql`${t.consumed} >= 0 and ((${t.source} = 'debt' and ${t.consumed} between ${t.amount} and 2 * ${t.amount}) or (${t.source} <> 'debt' and ${t.consumed} <= ${t.amount}))`,
    ),
    check(
      'credit_grant_debt_kind_check',
      sql`(${t.source} = 'debt') = (${t.debtKind} is not null) and (${t.debtKind} is null or ${t.debtKind} in ('usage', 'hold', 'refund', 'restored'))`,
    ),
    check(
      'credit_grant_hold_parent_check',
      sql`${t.debtKind} is distinct from 'hold' or ${t.parentGrantId} is not null`,
    ),
    check('credit_grant_expiry_after_issue_check', sql`${t.expiresAt} > ${t.issuedAt}`),
  ],
);

// One row per person who ever received welcome credits. It outlives every workspace and
// membership, so losing and regaining a workspace cannot grant them twice.
export const welcomeCreditGrant = pgTable('welcome_credit_grant', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
});
