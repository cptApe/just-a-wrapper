// No balance change: Stripe retries on its dunning schedule and invoice.paid owns the grant.
// Notification delivery must not trigger repeated payment-failed webhooks; the notification key deduplicates delivery.

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspace, workspaceNotDeleted } from '@/db/schema';
import { notify } from '@/features/notifications/api/notify';
import { requireStripe } from '@/lib/stripe';
import 'server-only';
import type Stripe from 'stripe';
import { type WebhookResult } from './webhook-result';

export async function handleInvoicePaymentFailed(
  event: Stripe.InvoicePaymentFailedEvent,
): Promise<WebhookResult> {
  const stripe = requireStripe();
  const invoice = await stripe.invoices.retrieve(event.data.object.id);
  if (invoice.status === 'paid' || invoice.status === 'void')
    return { status: 200, body: { received: true, stale: true } };
  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer?.id ?? null);
  if (!customerId) {
    return { status: 200, body: { received: true, ignored: 'invoice.payment_failed:no-customer' } };
  }
  const workspaceRow = (
    await db
      .select({ id: workspace.id, organizationId: workspace.organizationId })
      .from(workspace)
      .where(and(eq(workspace.stripeCustomerId, customerId), workspaceNotDeleted))
      .limit(1)
  ).at(0);
  if (!workspaceRow) {
    return {
      status: 200,
      body: { received: true, ignored: 'invoice.payment_failed:no-workspace' },
    };
  }

  await notify('payment.failed', {
    organizationId: workspaceRow.organizationId,
    idempotencyKey: `payment-failed:${event.id}`,
    data: {
      title: 'Payment failed',
      body: 'Your last payment didn’t go through. Update your payment method to keep your plan.',
    },
  });

  return { status: 200, body: { received: true, workspaceId: workspaceRow.id } };
}
