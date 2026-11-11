import 'server-only';
import type Stripe from 'stripe';
import { requireStripe } from '@/lib/stripe';
import { reconcileAutoTopupIntent } from './auto-topup-transitions';
import { grantTopupAndResume, resolveTopupGrantFromIntent } from './grant-topup';
import { type WebhookResult } from './webhook-result';

export async function handlePaymentIntentFailed(
  event: Stripe.PaymentIntentPaymentFailedEvent,
): Promise<WebhookResult> {
  const intent = event.data.object;
  if (!intent.metadata.auto_topup_attempt_id) return { status: 200, body: { received: true } };
  const stripe = requireStripe();
  const current = await stripe.paymentIntents.retrieve(intent.id);
  if (current.status === 'succeeded') {
    await grantTopupAndResume(current.id, resolveTopupGrantFromIntent(current));
    await reconcileAutoTopupIntent(current, 'succeeded');
  } else if (current.status !== 'processing') {
    if (current.status !== 'canceled') await stripe.paymentIntents.cancel(current.id);
    await reconcileAutoTopupIntent(current, 'failed');
  }
  return { status: 200, body: { received: true } };
}
