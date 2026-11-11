// Invoice identity deduplicates delivery independently of subscription metadata: the invoice's
// grant source references are the only record that an invoice was fulfilled.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { creditGrant, workspace } from '@/db/schema';
import { notify } from '@/features/notifications/api/notify';
import { BillingError } from '@/lib/errors';
import 'server-only';
import type Stripe from 'stripe';
import { formatCount } from '@/lib/format/format-number';
import { captureException } from '@/lib/observability';
import { invoiceGrantRef, invoiceGrantRefPrefix } from '../lib/grant-refs';
import {
  type BillingInterval,
  expiresAtMonthsAfter,
  planCreditExpiryMonths,
  YEARLY_DELIVERED_MONTHS,
} from '../pricing-config';
import { retireCreditGrants } from './credit-grant-transitions';
import type { BillingTx } from './credit-ledger';
import { issueCreditGrant, retireFuturePlanGrants } from './credit-ledger';
import { grantProration } from './grant-proration';
import { type LockedLedger, lockLedgerWhere } from './ledger-lock';
import { refundDeletedWorkspaceInvoice } from './refund-deleted-workspace-payment';
import type { Grant } from './resolve-invoice-grant';
import { resolveGrant } from './resolve-invoice-grant';
import {
  idOfExpandable,
  retrieveCurrentSubscription,
  subscriptionHasEnded,
} from './retrieve-current-subscription';
import { applyPlanEntitlement, cancelBillingSubscription } from './subscription-transitions';
import { scheduleWorkspaceSessionBudgetsAfterGrant } from './sync-session-budgets';
import { type WebhookResult } from './webhook-result';

const RENEWAL_GRACE_MS = 24 * 60 * 60_000;

// Changing interval re-anchors the billing period, so a paid interval change starts a full credit cycle.
function grantModeFor(
  reason: Stripe.Invoice.BillingReason | null,
  paidInterval: BillingInterval,
  currentInterval: BillingInterval | null,
): 'cycle' | 'delta' {
  if (reason !== 'subscription_update') return 'cycle';
  return currentInterval !== null && paidInterval !== currentInterval ? 'cycle' : 'delta';
}

// The webhook, a subscription update and the Checkout return page all pass the paid invoice here.
export async function handleInvoicePaid(
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<WebhookResult> {
  const grant = await resolveGrant(stripe, invoice);
  if (!grant || !grant.subscriptionId) {
    if (invoice.amount_paid > 0 && invoice.parent?.subscription_details?.subscription)
      captureException(
        new BillingError('EXTERNAL_API_FAILED', 'Paid subscription invoice has no plan metadata', {
          invoiceId: invoice.id,
          defect: 'missing-plan-metadata',
        }),
      );
    return { status: 200, body: { received: true, ignored: 'not-plan-invoice' } };
  }
  const subscriptionId = grant.subscriptionId;
  const observed = (
    await db
      .select({
        billingRevision: workspace.billingRevision,
        deletedAt: workspace.deletedAt,
        stripeSubscriptionId: workspace.stripeSubscriptionId,
      })
      .from(workspace)
      .where(eq(workspace.stripeCustomerId, grant.customerId))
  ).at(0);
  if (!observed) return refundUnmappedInvoice(stripe, invoice);
  const currentSubscription = await retrieveCurrentSubscription(stripe, subscriptionId, invoice.id);
  const duplicate =
    observed.deletedAt === null &&
    observed.stripeSubscriptionId !== null &&
    observed.stripeSubscriptionId !== subscriptionId
      ? await retrieveCurrentSubscription(stripe, observed.stripeSubscriptionId, invoice.id)
      : null;
  if (duplicate && !subscriptionHasEnded(duplicate)) {
    await cancelBillingSubscription(stripe, currentSubscription, 'duplicate-subscription');
    captureException(
      new BillingError('CONFLICT', 'Canceled a second workspace subscription', {
        invoiceId: invoice.id,
        subscriptionId,
        defect: 'duplicate-subscription',
      }),
    );
  }
  const authoritativeCurrent =
    !subscriptionHasEnded(currentSubscription) &&
    idOfExpandable(currentSubscription.latest_invoice) === invoice.id;
  const result = await db.transaction((tx) =>
    applyPaidInvoice(tx, {
      invoice,
      grant,
      subscriptionId,
      authoritativeCurrent,
      ended: subscriptionHasEnded(currentSubscription),
      observedRevision: observed.billingRevision,
    }),
  );

  if (result.kind === 'idempotent') {
    return { status: 200, body: { received: true, idempotent: true, invoiceId: invoice.id } };
  }
  if (result.kind === 'deleted') {
    await cancelBillingSubscription(stripe, currentSubscription, 'deleted-workspace');
    if (!result.fulfilled) await refundDeletedWorkspaceInvoice(stripe, invoice.id);
    return { status: 200, body: { received: true, ignored: 'deleted-workspace' } };
  }
  if (result.kind === 'unmapped') return refundUnmappedInvoice(stripe, invoice);

  // Renewal grants update budgets but do not post continuations; only purchased top-ups auto-resume sessions.
  scheduleWorkspaceSessionBudgetsAfterGrant(result.workspaceId);

  if (result.credits > 0)
    await notify('plan.updated', {
      organizationId: result.organizationId,
      idempotencyKey: `plan-updated:${invoice.id}`,
      data: {
        title: planUpdatedTitle(invoice.billing_reason),
        body: `${formatCount(result.credits)} plan credits were added for this cycle.`,
      },
    });

  return {
    status: 200,
    body: { received: true, workspaceId: result.workspaceId, credits: result.credits },
  };
}

// A paid invoice whose customer maps to no workspace can never be granted: refund it and report.
async function refundUnmappedInvoice(
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<WebhookResult> {
  await refundDeletedWorkspaceInvoice(stripe, invoice.id);
  captureException(
    new BillingError(
      'WORKSPACE_NOT_FOUND',
      'Refunded a plan invoice from a customer with no workspace',
      {
        invoiceId: invoice.id,
        defect: 'unmapped-customer-payment',
      },
    ),
  );
  return { status: 200, body: { received: true, ignored: 'no-workspace' } };
}

function planUpdatedTitle(reason: Stripe.Invoice.BillingReason | null): string {
  if (reason === 'subscription_create') return 'Plan activated';
  if (reason === 'subscription_update') return 'Plan changed';
  return 'Plan renewed';
}

async function hasInvoiceGrant(tx: BillingTx, workspaceId: string, invoiceId: string) {
  const rows = await tx
    .select({ id: creditGrant.id })
    .from(creditGrant)
    .where(
      and(
        eq(creditGrant.workspaceId, workspaceId),
        eq(creditGrant.source, 'plan'),
        sql`starts_with(${creditGrant.sourceRef}, ${invoiceGrantRefPrefix(invoiceId)})`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

function lockInvoiceWorkspace(tx: BillingTx, customerId: string) {
  return lockLedgerWhere(
    tx,
    tx
      .select({
        id: workspace.id,
        organizationId: workspace.organizationId,
        planBillingInterval: workspace.planBillingInterval,
        stripeSubscriptionId: workspace.stripeSubscriptionId,
        billingRevision: workspace.billingRevision,
        deletedAt: workspace.deletedAt,
      })
      .from(workspace)
      .where(eq(workspace.stripeCustomerId, customerId)),
    'update',
  );
}

type InvoiceWorkspace = NonNullable<Awaited<ReturnType<typeof lockInvoiceWorkspace>>>['row'];

// A delayed paid invoice can fulfill credits but must not overwrite newer subscription metadata.
async function applyInvoiceEntitlement(
  ledger: LockedLedger,
  input: {
    target: InvoiceWorkspace;
    authoritativeCurrent: boolean;
    grant: Grant;
    subscriptionId: string;
    invoice: Stripe.Invoice;
  },
) {
  const { tx } = ledger;
  const { target, grant, subscriptionId, invoice, authoritativeCurrent } = input;
  const expiryMonths = planCreditExpiryMonths();
  const mode = grantModeFor(invoice.billing_reason, grant.interval, target.planBillingInterval);

  // Proration grants only what actually cleared, not a full package difference for a partial period.
  if (mode === 'delta') {
    const granted = await grantProration(ledger, {
      invoiceId: invoice.id,
      paidCents: invoice.amount_paid,
      interval: grant.interval,
      expiryMonths,
    });
    if (authoritativeCurrent) {
      const moved = await applyPlanEntitlement(tx, {
        workspaceId: target.id,
        subscriptionId,
        grant,
        resetAt: null,
      });
      if (!moved)
        throw new BillingError('CONFLICT', 'Invoice entitlement lost its workspace guard', {
          workspaceId: target.id,
        });
    }
    return {
      kind: 'applied' as const,
      workspaceId: target.id,
      organizationId: target.organizationId,
      credits: granted,
    };
  }

  return grantInvoiceCycle(ledger, {
    target,
    grant,
    subscriptionId,
    invoice,
    authoritativeCurrent,
    expiryMonths,
  });
}

async function applyPaidInvoice(
  tx: BillingTx,
  input: {
    authoritativeCurrent: boolean;
    invoice: Stripe.Invoice;
    grant: Grant;
    subscriptionId: string;
    observedRevision: number;
    ended: boolean;
  },
) {
  const { invoice, grant, subscriptionId, authoritativeCurrent } = input;

  const locked = await lockInvoiceWorkspace(tx, grant.customerId);
  if (!locked) return { kind: 'unmapped' as const };
  const { row: target, ledger } = locked;
  // The workspace lock serializes deliveries, so a second one always sees the first one's grants.
  const fulfilled = await hasInvoiceGrant(tx, target.id, invoice.id);
  if (target.deletedAt !== null) return { kind: 'deleted' as const, fulfilled };
  if (fulfilled) return { kind: 'idempotent' as const };
  if (target.billingRevision !== input.observedRevision)
    throw new BillingError(
      'CONFLICT',
      'Subscription changed while Stripe was being read; retry reconciliation',
      { workspaceId: target.id },
    );

  const applied = await applyInvoiceEntitlement(ledger, {
    target,
    grant,
    subscriptionId,
    invoice,
    authoritativeCurrent:
      authoritativeCurrent &&
      (target.stripeSubscriptionId === null || target.stripeSubscriptionId === subscriptionId),
  });
  if (input.ended)
    await retireCreditGrants(
      ledger,
      sql`${creditGrant.source} = 'plan' and starts_with(${creditGrant.sourceRef}, ${invoiceGrantRefPrefix(invoice.id)})`,
    );
  return applied;
}

// Replace future plan buckets when a cycle restarts; a prepaid year still delivers credits monthly.
async function grantInvoiceCycle(
  ledger: LockedLedger,
  input: {
    target: InvoiceWorkspace;
    authoritativeCurrent: boolean;
    grant: Grant;
    subscriptionId: string;
    invoice: Stripe.Invoice;
    expiryMonths: number;
  },
) {
  const { tx, now } = ledger;
  const { target, grant, subscriptionId, invoice, authoritativeCurrent, expiryMonths } = input;
  if (authoritativeCurrent) {
    const moved = await applyPlanEntitlement(tx, {
      workspaceId: target.id,
      subscriptionId,
      grant,
      resetAt: now,
    });
    if (!moved)
      throw new BillingError('CONFLICT', 'Invoice entitlement lost its workspace guard', {
        workspaceId: target.id,
      });
    await retireFuturePlanGrants(ledger);
  }

  const periodStart = new Date(grant.period.start * 1000);
  const periodEnd = new Date(grant.period.end * 1000);
  const grantMonths = grant.interval === 'year' ? YEARLY_DELIVERED_MONTHS : 1;
  for (let month = 0; month < grantMonths; month += 1) {
    const scheduledAt = expiresAtMonthsAfter(periodStart, month);
    const future = scheduledAt > now;
    const monthIssuedAt = future ? scheduledAt : now;
    // Keep the final bucket available while Stripe finalizes and delivers the renewal invoice.
    const cycleEnd =
      month === grantMonths - 1 ? periodEnd : expiresAtMonthsAfter(periodStart, month + 1);
    const expiresAt =
      expiryMonths === 1 && cycleEnd > monthIssuedAt
        ? new Date(cycleEnd.getTime() + (month === grantMonths - 1 ? RENEWAL_GRACE_MS : 0))
        : expiresAtMonthsAfter(monthIssuedAt, expiryMonths);
    await issueCreditGrant(ledger, {
      source: 'plan',
      sourceRef: invoiceGrantRef(invoice.id, month),
      amount: grant.credits,
      issuedAt: future ? scheduledAt : 'now',
      expiresAt,
    });
  }

  return {
    kind: 'applied' as const,
    workspaceId: target.id,
    organizationId: target.organizationId,
    credits: grant.credits,
  };
}
