import 'server-only';
import type Stripe from 'stripe';
import {
  grantTopupAndResume,
  paymentIntentIdOf,
  resolveTopupGrant,
  topupResultBody,
} from './grant-topup';
import { settleManualTopupFromMetadata } from './manual-topup-transitions';
import { type WebhookResult } from './webhook-result';

// The webhook and the Checkout return page both pass the session here; the grant's source reference dedupes them.
export async function handleCheckoutCompleted(
  checkout: Stripe.Checkout.Session,
): Promise<WebhookResult> {
  // Subscription Checkout grants belong to invoice.paid; only settled one-off payments grant top-up credits.
  if (checkout.mode !== 'payment') {
    return {
      status: 200,
      body: { received: true, ignored: 'checkout.session.completed:non-payment' },
    };
  }
  if (checkout.payment_status !== 'paid') {
    return { status: 200, body: { received: true, ignored: 'checkout.session.completed:unpaid' } };
  }

  const grant = resolveTopupGrant(checkout);
  const paymentIntentId = paymentIntentIdOf(checkout);
  const result = await grantTopupAndResume(paymentIntentId, grant);
  await settleManualTopupFromMetadata(checkout.metadata, paymentIntentId);

  return {
    status: 200,
    body: {
      received: true,
      purchase: checkout.metadata?.manual_attempt_key
        ? {
            key: checkout.metadata.manual_attempt_key,
            credits: grant.credits,
            workspaceId: result.workspaceId,
          }
        : null,
      credits: grant.credits,
      ...topupResultBody(result),
    },
  };
}
