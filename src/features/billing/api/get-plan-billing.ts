import { captureException } from '@/lib/observability';
import { getStripe } from '@/lib/stripe';
import 'server-only';
import type Stripe from 'stripe';
import { cardLast4Of } from '../lib/payment-method';
import { defaultCardPaymentMethod } from './default-card-payment-method';
import type { ActiveWorkspace } from './resolve-workspace';
import { type SubscriptionState, subscriptionStateOf } from './subscription-state';
export type NextBill = {
  amountCents: number;
  currency: string;
  date: Date;
  cardLast4: string;
};
type PlanBilling = {
  planPriceCents: number | null;
  planPriceCurrency: string;
  planInterval: string;
  nextBill?: NextBill;
  state: SubscriptionState;
};
export async function getPlanBilling(workspace: ActiveWorkspace): Promise<PlanBilling | null> {
  const stripe = getStripe();
  if (!stripe || !workspace.stripeSubscriptionId) {
    return null;
  }
  try {
    const subscription = await stripe.subscriptions.retrieve(workspace.stripeSubscriptionId, {
      expand: ['default_payment_method'],
    });
    const item = subscription.items.data.at(0);
    if (!item) {
      return null;
    }
    const price = item.price;
    // Billing-detail recovery: hide an unavailable preview but keep the stored plan and balance usable.
    let nextBill: NextBill | undefined;
    try {
      nextBill = await buildNextBill(stripe, subscription, item, workspace);
    } catch (error) {
      captureException(error, {
        feature: 'billing',
        op: 'next-bill',
        workspaceId: workspace.id,
      });
    }

    const state = await subscriptionStateOf(stripe, subscription, item);
    return {
      state,
      planPriceCents: price.unit_amount === null ? null : price.unit_amount * (item.quantity ?? 1),
      planPriceCurrency: price.currency,
      planInterval: price.recurring?.interval ?? 'month',
      nextBill,
    };
  } catch (error) {
    // Billing-summary recovery: Stripe detail is optional; the database-backed balance and plan remain available.
    captureException(error, {
      feature: 'billing',
      op: 'get-plan-billing',
      workspaceId: workspace.id,
    });
    return null;
  }
}
// Only the invoice preview includes coupons, tax and proration; never invent a charge from the flat price.
async function buildNextBill(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  item: Stripe.SubscriptionItem,
  workspace: ActiveWorkspace,
): Promise<NextBill | undefined> {
  const cardLast4 = cardLast4Of(
    await defaultCardPaymentMethod(stripe, workspace.stripeCustomerId, subscription, 'expanded'),
  );
  if (!cardLast4) {
    return undefined;
  }
  const preview = await stripe.invoices.createPreview({ subscription: subscription.id });

  return {
    amountCents: preview.amount_due,
    currency: preview.currency,
    date: new Date(item.current_period_end * 1000),
    cardLast4,
  };
}
