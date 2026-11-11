import { env } from '@/lib/env';
import { BillingError } from '@/lib/errors';
import { requireStripe } from '@/lib/stripe';
import 'server-only';
import { CURRENCY, TOPUP_PRODUCT_ID } from '../catalog';
import { buildCheckoutSuccessUrl } from '../lib/checkout-return-url';
import { topupAmountCents } from '../pricing-config';
import { ensureCustomer } from './ensure-customer';
import type { ActiveWorkspace } from './resolve-workspace';

// Stamp the same credit metadata on Checkout and its intent so both webhook paths resolve one purchase.
// The return URL carries Stripe's session placeholder so the page can reconcile when webhook delivery is delayed.
export async function createTopupCheckoutSession(input: {
  workspace: ActiveWorkspace;
  credits: number;
  idempotencyKey: string;
}): Promise<{ outcome: 'fallback'; url: string } | { outcome: 'already_charged' | 'expired' }> {
  const stripe = requireStripe();

  const amount = topupAmountCents(input.credits);
  const customerId = await ensureCustomer(stripe, input.workspace);
  const appUrl = env.NEXT_PUBLIC_APP_URL;

  const topupMetadata = {
    kind: 'topup',
    manual_attempt_key: input.idempotencyKey,
    workspace_id: input.workspace.id,
    organization_id: input.workspace.organizationId,
    credits: String(input.credits),
  };

  try {
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer: customerId,
        allow_promotion_codes: false,
        line_items: [
          {
            price_data: { product: TOPUP_PRODUCT_ID, currency: CURRENCY, unit_amount: amount },
            quantity: 1,
          },
        ],
        client_reference_id: input.workspace.id,
        metadata: topupMetadata,
        payment_intent_data: { metadata: topupMetadata },
        success_url: buildCheckoutSuccessUrl(appUrl, 'topup'),
        cancel_url: `${appUrl}/app/settings/billing?topup=cancelled`,
      },
      { idempotencyKey: `topup-checkout:${input.workspace.id}:${input.idempotencyKey}` },
    );

    if (checkout.status !== 'open')
      return { outcome: checkout.status === 'complete' ? 'already_charged' : 'expired' };
    if (!checkout.url) {
      throw new BillingError(
        'EXTERNAL_API_FAILED',
        'Stripe returned a checkout session with no URL',
        {
          checkoutId: checkout.id,
        },
      );
    }
    return { outcome: 'fallback', url: checkout.url };
  } catch (cause) {
    if (cause instanceof BillingError) throw cause;
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Could not open top-up Checkout',
      { customerId },
      { cause },
    );
  }
}
