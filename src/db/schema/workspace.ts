import { eq, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization } from './auth';

// A workspace = a Better Auth organization, extended with app-specific billing
// and memory-store state. `organization_id` FKs to Better Auth's `organization`
// with ON DELETE cascade: a workspace is the org's app-side extension and must
// not outlive it. Stripe ids are partial-unique (one Stripe customer/subscription
// maps to at most one workspace).
export const workspace = pgTable(
  'workspace',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .unique()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    budgetSyncStatus: text('budget_sync_status')
      .$type<'idle' | 'pending' | 'syncing'>()
      .notNull()
      .default('idle'),
    budgetSyncRevision: integer('budget_sync_revision').notNull().default(0),
    budgetSyncLease: uuid('budget_sync_lease'),
    budgetSyncLeaseUntil: timestamp('budget_sync_lease_until', { withTimezone: true }),
    billingRevision: integer('billing_revision').notNull().default(0),
    stripeCustomerId: text('stripe_customer_id'),
    stripeCustomerGeneration: integer('stripe_customer_generation').notNull().default(0),
    stripeSubscriptionId: text('stripe_subscription_id'),
    // 'none' is a workspace without a subscription (welcome credits only).
    planTier: text('plan_tier').$type<'none' | 'pro' | 'max'>().notNull().default('none'),
    planBillingInterval: text('plan_billing_interval').$type<'month' | 'year'>(),
    // The monthly credit package the subscription is on; null without a plan.
    planCredits: integer('plan_credits'),
    creditResetAt: timestamp('credit_reset_at', { withTimezone: true }),
    // Keep schema defaults local: DB schema must not import feature modules.
    // tests/billing/auto-topup.test.mjs pins these to AUTO_TOPUP.
    autoTopupEnabled: boolean('auto_topup_enabled').notNull().default(false),
    autoTopupThresholdCredits: integer('auto_topup_threshold_credits').notNull().default(20),
    autoTopupCredits: integer('auto_topup_credits').notNull().default(1000),
    autoTopupMonthlyCapCents: integer('auto_topup_monthly_cap_cents').notNull().default(25_000),
    workspaceMemoryStoreId: text('workspace_memory_store_id'),
    // Retain discarded member contexts until provider deletion succeeds.
    browserContextCleanupIds: text('browser_context_cleanup_ids')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),

    // Soft-delete stamp (Settings/Workspace → Danger zone → Delete). Non-null =
    // the workspace is deleted: it stops resolving for every member and drops
    // out of every switcher/listing (see `workspaceNotDeleted`). The row and its
    // Better Auth `organization` are deliberately kept for a 30-day internal
    // legal and operations buffer; a purge job reclaims them afterwards.
    lifecycleStatus: text('lifecycle_status')
      .$type<'live' | 'deleting' | 'deleted' | 'purging'>()
      .notNull()
      .default('live'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    purgeAttemptedAt: timestamp('purge_attempted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'workspace_budget_sync_status_check',
      sql`${t.budgetSyncStatus} in ('idle', 'pending', 'syncing')`,
    ),
    check(
      'workspace_budget_sync_lease_check',
      sql`(${t.budgetSyncStatus} = 'syncing' and ${t.budgetSyncLease} is not null and ${t.budgetSyncLeaseUntil} is not null) or (${t.budgetSyncStatus} <> 'syncing' and ${t.budgetSyncLease} is null and ${t.budgetSyncLeaseUntil} is null)`,
    ),
    check(
      'workspace_lifecycle_status_check',
      sql`${t.lifecycleStatus} in ('live', 'deleting', 'deleted', 'purging')`,
    ),
    check(
      'workspace_lifecycle_timestamp_check',
      sql`(${t.lifecycleStatus} = 'live') = (${t.deletedAt} is null)`,
    ),
    uniqueIndex('workspace_stripe_customer_id_uidx')
      .on(t.stripeCustomerId)
      .where(sql`${t.stripeCustomerId} is not null`),
    uniqueIndex('workspace_stripe_subscription_id_uidx')
      .on(t.stripeSubscriptionId)
      .where(sql`${t.stripeSubscriptionId} is not null`),
    check(
      'workspace_plan_entitlement_check',
      sql`(${t.planTier} = 'none' and ${t.stripeSubscriptionId} is null and ${t.planCredits} is null) or (${t.planTier} in ('pro', 'max') and ${t.stripeSubscriptionId} is not null and ${t.planBillingInterval} is not null and ${t.planCredits} is not null and ${t.planCredits} > 0)`,
    ),
    check('workspace_plan_tier_check', sql`${t.planTier} in ('none', 'pro', 'max')`),
    check(
      'workspace_plan_billing_interval_check',
      sql`(${t.planTier} = 'none' and ${t.planBillingInterval} is null) or (${t.planTier} in ('pro', 'max') and ${t.planBillingInterval} in ('month', 'year'))`,
    ),
    check(
      'workspace_no_plan_auto_topup_disabled_check',
      sql`${t.planTier} <> 'none' or ${t.autoTopupEnabled} = false`,
    ),
    check(
      'workspace_auto_topup_threshold_nonnegative_check',
      sql`${t.autoTopupThresholdCredits} >= 0`,
    ),
    check('workspace_auto_topup_credits_positive_check', sql`${t.autoTopupCredits} > 0`),
    check(
      'workspace_auto_topup_monthly_cap_nonnegative_check',
      sql`${t.autoTopupMonthlyCapCents} >= 0`,
    ),
  ],
);

// The single soft-delete predicate. Every member-facing workspace resolution
// and listing composes this into its WHERE so a deleted workspace uniformly
// stops resolving — one definition rather than an `isNull(deletedAt)` scattered
// across call sites that can drift.
export const workspaceNotDeleted = eq(workspace.lifecycleStatus, 'live');
