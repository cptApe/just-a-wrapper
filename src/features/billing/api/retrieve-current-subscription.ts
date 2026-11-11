import { BillingError } from '@/lib/errors';
import 'server-only';
import type Stripe from 'stripe';

export function subscriptionHasEnded(subscription: Pick<Stripe.Subscription, 'status'>): boolean {
  return ['canceled', 'unpaid', 'incomplete_expired'].includes(subscription.status);
}

export function idOfExpandable(value: string | { id: string } | null): string | null {
  return typeof value === 'string' ? value : (value?.id ?? null);
}

export async function retrieveCurrentSubscription(
  stripe: Stripe,
  subscriptionId: string,
  eventId: string,
): Promise<Stripe.Subscription> {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId);
  } catch (cause) {
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'failed to reconcile current Stripe subscription',
      { subscriptionId, eventId },
      { cause },
    );
  }
}
