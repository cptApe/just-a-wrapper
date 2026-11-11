import { env } from '@/lib/env';
import { BillingError, WebhookError } from '@/lib/errors';
import { requireStripe } from '@/lib/stripe';
import { STRIPE_WEBHOOK_EVENTS } from '../lib/stripe-webhook-events';
import { handleChargeReversal } from './handle-charge-reversal';
import 'server-only';
import type Stripe from 'stripe';
import { deleteStripeCustomer } from './customer-transitions';
import { handleCheckoutCompleted } from './handle-checkout-completed';
import { handleInvoicePaid } from './handle-invoice-paid';
import { handleInvoicePaymentFailed } from './handle-invoice-payment-failed';
import { handlePaymentIntentFailed } from './handle-payment-intent-failed';
import { handlePaymentIntentSucceeded } from './handle-payment-intent-succeeded';
import { handleSubscriptionEnded } from './handle-subscription-ended';
import { handleSubscriptionUpdated } from './handle-subscription-updated';
import { subscriptionHasEnded } from './retrieve-current-subscription';
import { recordStripeReceipt } from './stripe-event-receipts';
import { type WebhookResult } from './webhook-result';

export async function processStripeWebhook(
  rawBody: string,
  signature: string | null,
): Promise<WebhookResult> {
  const stripe = requireStripe();
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret)
    throw new BillingError('EXTERNAL_API_FAILED', 'Stripe webhook secret is not configured');
  if (!signature) {
    throw new WebhookError('WEBHOOK_SIGNATURE_INVALID', 'missing stripe-signature header');
  }

  const event = await verifyStripeEvent(stripe, rawBody, signature, secret);

  await recordStripeReceipt(event);

  if (!STRIPE_WEBHOOK_EVENTS.some((type) => type === event.type))
    return { status: 200, body: { received: true, ignored: event.type } };
  switch (event.type) {
    case 'refund.updated':
    case 'refund.failed':
    case 'charge.refunded':
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed':
    case 'charge.dispute.funds_withdrawn':
    case 'charge.dispute.funds_reinstated':
      return handleChargeReversal(stripe, event);
    case 'customer.deleted':
      await deleteStripeCustomer(event.data.object.id);
      return { status: 200, body: { received: true } };
    case 'invoice.paid':
      return handleInvoicePaid(stripe, event.data.object);
    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(event);
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event.data.object);
    case 'payment_intent.succeeded':
      return handlePaymentIntentSucceeded(event);
    case 'payment_intent.payment_failed':
      return handlePaymentIntentFailed(event);
    case 'customer.subscription.deleted':
      return handleSubscriptionEnded(event, stripe);
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      return subscriptionHasEnded(subscription)
        ? handleSubscriptionEnded(event, stripe)
        : handleSubscriptionUpdated(event, stripe);
    }
    default:
      throw new BillingError('UNEXPECTED', 'Subscribed Stripe event has no handler', {
        eventType: event.type,
      });
  }
}

async function verifyStripeEvent(
  stripe: Stripe,
  rawBody: string,
  signature: string,
  secret: string,
): Promise<Stripe.Event> {
  try {
    return await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch (cause) {
    throw new WebhookError(
      'WEBHOOK_SIGNATURE_INVALID',
      'stripe signature verification failed',
      {},
      { cause },
    );
  }
}
