import { env } from '@/lib/env';
import { BillingError } from '@/lib/errors';
import { formatCount } from '@/lib/format/format-number';
import { requireStripe } from '@/lib/stripe';
import 'server-only';
import { buildCheckoutSuccessUrl } from '../lib/checkout-return-url';
import type { PlanChoice } from '../lib/plan-picker-packs';
import { PLANS } from '../pricing-config';
import { ensureCustomer } from './ensure-customer';
import { assertPlansOnSale } from './get-plan-options';
import { listPlanPrices, requirePlanPack } from './list-plan-prices';
import type { ActiveWorkspace } from './resolve-workspace';
import { subscriptionHasEnded } from './retrieve-current-subscription';
import { cancelBillingSubscription } from './subscription-transitions';

// A first plan goes through Stripe Checkout in subscription mode. invoice.paid grants the credits
// and records the plan; the return page reconciles in case that webhook is late.
export async function createPlanCheckoutSession(input: {
  workspace: ActiveWorkspace;
  choice: PlanChoice;
}): Promise<{ url: string }> {
  const { workspace, choice } = input;
  await assertPlansOnSale(workspace.id);
  if (workspace.stripeSubscriptionId) {
    throw new BillingError('CONFLICT', 'This workspace already has a plan. Change it instead.', {
      workspaceId: workspace.id,
    });
  }
  const stripe = requireStripe();
  const pack = requirePlanPack(await listPlanPrices(), choice);
  const customerId = await ensureCustomer(stripe, workspace);
  try {
    // A subscription that never bound locally (an unpaid first invoice) blocks a second one.
    for await (const subscription of stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
    })) {
      if (subscription.status === 'incomplete' || subscription.status === 'unpaid') {
        await cancelBillingSubscription(stripe, subscription, 'duplicate-subscription');
      } else if (!subscriptionHasEnded(subscription)) {
        throw new BillingError(
          'CONFLICT',
          'This workspace already has a plan. Refresh the page to see it.',
          { workspaceId: workspace.id, subscriptionId: subscription.id },
        );
      }
    }
    // Reuse an open Checkout for the same price; close any other so two plans cannot be bought.
    let reusable: string | null = null;
    for await (const open of stripe.checkout.sessions.list({
      customer: customerId,
      status: 'open',
      expand: ['data.line_items'],
      limit: 100,
    })) {
      if (open.mode !== 'subscription') continue;
      if (reusable === null && open.url && open.line_items?.data.at(0)?.price?.id === pack.priceId)
        reusable = open.url;
      else await stripe.checkout.sessions.expire(open.id);
    }
    if (reusable) return { url: reusable };

    const appUrl = env.NEXT_PUBLIC_APP_URL;
    const metadata = {
      workspace_id: workspace.id,
      organization_id: workspace.organizationId,
      tier: pack.tier,
      interval: pack.interval,
      credits: String(pack.credits),
    };
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: pack.priceId, quantity: 1 }],
        client_reference_id: workspace.id,
        metadata,
        subscription_data: { metadata },
        custom_text: {
          submit: {
            message: `${PLANS[pack.tier].name} adds ${formatCount(pack.credits)} credits every month.`,
          },
        },
        success_url: buildCheckoutSuccessUrl(appUrl, 'plan'),
        cancel_url: `${appUrl}/app/settings/billing?checkout=cancelled`,
      },
      // A double click inside one minute opens the same Checkout.
      {
        idempotencyKey: `plan-checkout:${workspace.id}:${pack.priceId}:${Math.floor(Date.now() / 60_000)}`,
      },
    );
    if (!checkout.url) {
      throw new BillingError('EXTERNAL_API_FAILED', 'Stripe returned a Checkout with no URL', {
        checkoutId: checkout.id,
      });
    }
    return { url: checkout.url };
  } catch (cause) {
    if (cause instanceof BillingError) throw cause;
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Could not open plan Checkout',
      { workspaceId: workspace.id, priceId: pack.priceId },
      { cause },
    );
  }
}
