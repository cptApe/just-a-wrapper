import type Stripe from 'stripe';
import { BillingError } from '@/lib/errors';
import type { TopupChargeResult } from './charge-topup';
import {
  grantTopupAndResume,
  paymentIntentIdOf,
  resolveTopupGrant,
  resolveTopupGrantFromIntent,
} from './grant-topup';

// An expired idempotency key is never reused to create a charge. Resolve the original provider objects first.
export async function reconcileManualTopup(
  stripe: Stripe,
  input: {
    customerId: string;
    idempotencyKey: string;
    createdAt: Date;
  },
): Promise<TopupChargeResult> {
  try {
    const created = { gte: Math.floor(input.createdAt.getTime() / 1000) - 60 };
    for await (const checkout of stripe.checkout.sessions.list({
      customer: input.customerId,
      created,
      limit: 100,
    })) {
      if (checkout.metadata?.manual_attempt_key !== input.idempotencyKey) continue;
      if (checkout.payment_status === 'paid') {
        const purchased = resolveTopupGrant(checkout);
        await grantTopupAndResume(paymentIntentIdOf(checkout), purchased);
        return { outcome: 'already_charged' };
      }
      if (checkout.status === 'open' && checkout.url)
        return { outcome: 'fallback', url: checkout.url };
    }
    for await (const intent of stripe.paymentIntents.list({
      customer: input.customerId,
      created,
      limit: 100,
    })) {
      if (intent.metadata.manual_attempt_key !== input.idempotencyKey) continue;
      if (intent.status === 'succeeded') {
        const purchased = resolveTopupGrantFromIntent(intent);
        await grantTopupAndResume(intent.id, purchased);
        return { outcome: 'already_charged' };
      }
      if (intent.status === 'processing') return { outcome: 'processing' };
      if (intent.status !== 'canceled') await stripe.paymentIntents.cancel(intent.id);
    }
    return { outcome: 'expired' };
  } catch (cause) {
    if (cause instanceof BillingError) throw cause;
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Could not reconcile manual top-up',
      { customerId: input.customerId, attempt: input.idempotencyKey },
      { cause },
    );
  }
}
