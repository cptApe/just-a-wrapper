import type Stripe from 'stripe';

export function cardLast4Of(pm: string | Stripe.PaymentMethod | null | undefined): string | null {
  if (!pm || typeof pm === 'string') {
    return null;
  }
  return pm.card?.last4 ?? null;
}
