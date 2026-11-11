import 'server-only';
import { eq, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '@/db';
import { workspace } from '@/db/schema';
import { BillingError } from '@/lib/errors';
import type { BillingTx } from './credit-ledger';
import { findPaymentGrants } from './find-payment-grants';
import { type LockedLedger, lockLedgerWhere } from './ledger-lock';
import { invoiceExpectsGrant, resolveGrant } from './resolve-invoice-grant';
import { idOfExpandable } from './retrieve-current-subscription';
import { reversePaymentGrant } from './reverse-payment-grants';
import { scheduleWorkspaceSessionBudgetsAfterGrant } from './sync-session-budgets';
import type { WebhookResult } from './webhook-result';

type ReversalEvent = Extract<
  Stripe.Event,
  { type: 'charge.refunded' | 'refund.updated' | 'refund.failed' | `charge.dispute.${string}` }
>;

// Read current Stripe state, then reject concurrent ledger changes before applying the observation.
// Applying the same observation twice changes nothing: reversal progress rows record what was removed.
export async function handleChargeReversal(
  stripe: Stripe,
  event: ReversalEvent,
): Promise<WebhookResult> {
  const object = event.data.object;
  const chargeId = object.object === 'charge' ? object.id : idOfExpandable(object.charge);
  if (!chargeId)
    throw new BillingError('VALIDATION_FAILED', 'Dispute has no charge', { eventId: event.id });
  const charge = await stripe.charges.retrieve(chargeId);
  const customerId = idOfExpandable(charge.customer);
  if (!customerId) return { status: 200, body: { received: true, ignored: 'no-customer' } };
  const [observed] = await db
    .select({ revision: workspace.billingRevision })
    .from(workspace)
    .where(eq(workspace.stripeCustomerId, customerId));
  if (!observed) return { status: 200, body: { received: true, ignored: 'no-workspace' } };
  // Refunds and disputes are read after the revision; the charge supplies only immutable purchase identity.
  const { reversedAmount, invoices } = await readReversedPurchases(stripe, charge);
  const paymentIntentId = idOfExpandable(charge.payment_intent);
  const workspaceId = await db.transaction((tx) =>
    applyReversal(tx, {
      charge,
      customerId,
      observedRevision: observed.revision,
      reversedAmount,
      invoices,
      paymentIntentId,
    }),
  );
  if (workspaceId) scheduleWorkspaceSessionBudgetsAfterGrant(workspaceId);
  return { status: 200, body: { received: true } };
}

async function readReversedPurchases(stripe: Stripe, charge: Stripe.Charge) {
  let disputedAmount = 0;
  for await (const dispute of stripe.disputes.list({ charge: charge.id, limit: 100 })) {
    if (
      dispute.status !== 'won' &&
      dispute.status !== 'warning_closed' &&
      dispute.status !== 'prevented' &&
      dispute.status !== 'warning_needs_response' &&
      dispute.status !== 'warning_under_review'
    )
      disputedAmount += dispute.amount;
  }
  const paymentIntentId = idOfExpandable(charge.payment_intent);
  const invoices: Array<{ id: string; amountPaid: number; expectsGrant: boolean }> = [];
  if (paymentIntentId) {
    for await (const payment of stripe.invoicePayments.list({
      payment: { type: 'payment_intent', payment_intent: paymentIntentId },
      limit: 100,
    })) {
      const invoiceId = idOfExpandable(payment.invoice);
      if (invoiceId) {
        const invoice = await stripe.invoices.retrieve(invoiceId);
        invoices.push({
          id: invoiceId,
          amountPaid: invoice.amount_paid,
          expectsGrant: invoiceExpectsGrant(invoice, await resolveGrant(stripe, invoice)),
        });
      }
    }
  }
  let refundedAmount = 0;
  for await (const refund of stripe.refunds.list({ charge: charge.id, limit: 100 })) {
    if (refund.status !== 'failed' && refund.status !== 'canceled') refundedAmount += refund.amount;
  }
  return { reversedAmount: Math.min(charge.amount, refundedAmount + disputedAmount), invoices };
}

async function applyReversal(
  tx: BillingTx,
  input: {
    charge: Stripe.Charge;
    customerId: string;
    observedRevision: number;
    reversedAmount: number;
    invoices: Awaited<ReturnType<typeof readReversedPurchases>>['invoices'];
    paymentIntentId: string | null;
  },
) {
  const { charge, customerId, observedRevision, reversedAmount, invoices, paymentIntentId } = input;
  const chargeId = charge.id;
  const locked = await lockLedgerWhere(
    tx,
    tx.select().from(workspace).where(eq(workspace.stripeCustomerId, customerId)),
    'no key update',
  );
  if (!locked || locked.row.deletedAt !== null) return null;
  const { row: target, ledger } = locked;
  if (observedRevision !== target.billingRevision)
    throw new BillingError('CONFLICT', 'Billing changed while reading a reversed payment', {
      chargeId,
    });
  const grants = await findPaymentGrants(tx, {
    workspaceId: target.id,
    paymentIntentId,
    chargeAmount: charge.amount,
    invoices,
  });
  if (grants.length === 0 && hasUnfulfilledPurchase(invoices, charge))
    throw new BillingError('CONFLICT', 'Reversed payment is waiting for its credit grant', {
      chargeId,
    });
  const changed = await reversePurchases(ledger, grants, chargeId, reversedAmount, {
    planActive: target.stripeSubscriptionId !== null,
  });
  // A redelivered observation moves nothing and must not bump the revision other handlers compare.
  if (!changed) return null;
  await tx
    .update(workspace)
    .set({ billingRevision: sql`${workspace.billingRevision} + 1` })
    .where(eq(workspace.id, target.id));
  return target.id;
}

// A reversal that arrives before its grant must wait, or the later grant would keep refunded credits.
function hasUnfulfilledPurchase(
  invoices: Awaited<ReturnType<typeof readReversedPurchases>>['invoices'],
  charge: Stripe.Charge,
): boolean {
  return charge.metadata.kind === 'topup' || invoices.some((invoice) => invoice.expectsGrant);
}

async function reversePurchases(
  ledger: LockedLedger,
  grants: Awaited<ReturnType<typeof findPaymentGrants>>,
  chargeId: string,
  reversedAmount: number,
  options: { planActive: boolean },
): Promise<boolean> {
  let changed = false;
  for (const { grant, paidAmount: denominator } of grants) {
    if (denominator <= 0)
      throw new BillingError('VALIDATION_FAILED', 'Reversed payment has no paid amount', {
        chargeId,
      });
    const moved = await reversePaymentGrant(ledger, {
      grant,
      planActive: options.planActive,
      chargeId,
      removedFraction: Math.min(1, reversedAmount / denominator),
    });
    changed ||= moved;
  }
  return changed;
}
