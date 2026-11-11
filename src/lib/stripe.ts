import Stripe from 'stripe';
import { BillingError } from './errors';
import { lazyValue } from './lazy-value';
import { capabilities } from './runtime-capabilities';

// Pin the API version to the installed SDK so response shapes cannot change independently.
export const STRIPE_API_VERSION = '2026-05-27.dahlia';

export const getStripe = lazyValue((): Stripe | null => {
  const { billing } = capabilities;
  return billing.kind === 'stripe'
    ? new Stripe(billing.secretKey, {
        apiVersion: STRIPE_API_VERSION,
        typescript: true,
        appInfo: { name: 'just-a-wrapper' },
      })
    : null;
});

export function requireStripe(): Stripe {
  const stripe = getStripe();
  if (!stripe) throw new BillingError('INTEGRATION_NOT_CONNECTED', 'Stripe is not configured', {});
  return stripe;
}
