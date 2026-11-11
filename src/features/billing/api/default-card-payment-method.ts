import 'server-only';
import Stripe from 'stripe';
import { BillingError } from '@/lib/errors';

// The subscription default precedes the customer invoice default; never guess another saved card.
export async function defaultCardPaymentMethod(
  stripe: Stripe,
  customerId: string | null,
  subscription: string | Stripe.Subscription | null,
  expansion: 'id' | 'expanded',
): Promise<string | Stripe.PaymentMethod | null> {
  const subscriptionId =
    typeof subscription === 'string' ? subscription : (subscription?.id ?? null);
  try {
    const resolved =
      typeof subscription === 'string'
        ? await readSubscription(stripe, subscription)
        : subscription;
    let paymentMethod = resolved?.default_payment_method ?? null;
    if (!paymentMethod && customerId) {
      const customer = await stripe.customers.retrieve(customerId);
      if (!customer.deleted) paymentMethod = customer.invoice_settings.default_payment_method;
    }
    return expansion === 'expanded' && typeof paymentMethod === 'string'
      ? await stripe.paymentMethods.retrieve(paymentMethod)
      : paymentMethod;
  } catch (cause) {
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'failed to resolve default payment method',
      { customerId, subscriptionId },
      { cause },
    );
  }
}

async function readSubscription(
  stripe: Stripe,
  subscriptionId: string,
): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId);
  } catch (cause) {
    // A deleted subscription can precede its webhook; the customer's invoice default still applies.
    if (
      cause instanceof Stripe.errors.StripeInvalidRequestError &&
      cause.code === 'resource_missing'
    )
      return null;
    throw cause;
  }
}
