import 'server-only';
import type Stripe from 'stripe';
import { reconcileAutoTopupIntent } from './auto-topup-transitions';
import { grantTopupAndResume, resolveTopupGrantFromIntent, topupResultBody } from './grant-topup';
import { settleManualTopupFromMetadata } from './manual-topup-transitions';
import { type WebhookResult } from './webhook-result';

export async function handlePaymentIntentSucceeded(
  event: Stripe.PaymentIntentSucceededEvent,
): Promise<WebhookResult> {
  const intent = event.data.object;
  const kind = intent.metadata.kind;

  // Empty or absent metadata both mean the intent has no billing kind.
  if (kind !== 'topup') {
    return {
      status: 200,
      body: {
        received: true,
        ignored: `payment_intent.succeeded:${kind || 'none'}`,
      },
    };
  }

  const grant = resolveTopupGrantFromIntent(intent);
  const result = await grantTopupAndResume(intent.id, grant);
  await reconcileAutoTopupIntent(intent, 'succeeded');
  await settleManualTopupFromMetadata(intent.metadata, intent.id);

  return {
    status: 200,
    body: { received: true, credits: grant.credits, ...topupResultBody(result) },
  };
}
