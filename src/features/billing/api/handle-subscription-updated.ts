import 'server-only';
import type Stripe from 'stripe';
import { BillingError } from '@/lib/errors';
import { handleInvoicePaid } from './handle-invoice-paid';
import { handleSubscriptionEnded } from './handle-subscription-ended';
import {
  idOfExpandable,
  retrieveCurrentSubscription,
  subscriptionHasEnded,
} from './retrieve-current-subscription';
import type { WebhookResult } from './webhook-result';

// The paid invoice owns entitlement. Unpaid changes cannot increase or decrease the purchased package.
export async function handleSubscriptionUpdated(
  event: Stripe.CustomerSubscriptionUpdatedEvent,
  stripe: Stripe,
): Promise<WebhookResult> {
  const eventSubscription = event.data.object;
  const subscription = await retrieveCurrentSubscription(stripe, eventSubscription.id, event.id);
  if (subscriptionHasEnded(subscription)) return handleSubscriptionEnded(event, stripe);
  const invoiceId = idOfExpandable(subscription.latest_invoice);
  if (!invoiceId) return { status: 200, body: { received: true, kind: 'deferred' } };
  let invoice: Stripe.Invoice;
  try {
    invoice = await stripe.invoices.retrieve(invoiceId);
  } catch (cause) {
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Could not read subscription invoice',
      { invoiceId, subscriptionId: subscription.id },
      { cause },
    );
  }
  if (invoice.status !== 'paid') return { status: 200, body: { received: true, kind: 'pending' } };
  return handleInvoicePaid(stripe, invoice);
}
