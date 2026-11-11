import { BillingError } from '@/lib/errors';
import 'server-only';
import type Stripe from 'stripe';
import type { PlanChoice } from '../lib/plan-picker-packs';
import { isPlanTier } from '../pricing-config';
import { idOfExpandable } from './retrieve-current-subscription';

/** What a person needs to see about their subscription; Stripe holds it, so it is read each time. */
export type SubscriptionState = {
  status: Stripe.Subscription.Status;
  /** When the current period ends: the next renewal, or the end date if it is cancelled. */
  periodEnd: Date | null;
  /** Set when the subscription ends at the period end instead of renewing. */
  cancelsAt: Date | null;
  /** A plan change waiting for the next renewal, from the subscription schedule. */
  scheduled: (PlanChoice & { priceId: string; startsAt: Date }) | null;
};

export type LoadedSubscription = {
  subscription: Stripe.Subscription;
  item: Stripe.SubscriptionItem;
  state: SubscriptionState;
};

export async function loadSubscription(
  stripe: Stripe,
  subscriptionId: string,
): Promise<LoadedSubscription> {
  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (cause) {
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Could not read the subscription from Stripe',
      { subscriptionId },
      { cause },
    );
  }
  const item = subscription.items.data.at(0);
  if (!item) {
    throw new BillingError('EXTERNAL_API_FAILED', 'The subscription has no item', {
      subscriptionId,
    });
  }
  return { subscription, item, state: await subscriptionStateOf(stripe, subscription, item) };
}

export async function subscriptionStateOf(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  item: Stripe.SubscriptionItem,
): Promise<SubscriptionState> {
  const scheduleId = idOfExpandable(subscription.schedule);
  const scheduled = scheduleId ? await scheduledChange(stripe, scheduleId, item) : null;
  const periodEnd = item.current_period_end ? new Date(item.current_period_end * 1000) : null;
  const cancelsAt = subscription.cancel_at
    ? new Date(subscription.cancel_at * 1000)
    : subscription.cancel_at_period_end
      ? periodEnd
      : null;
  return { status: subscription.status, periodEnd, cancelsAt, scheduled };
}

// The first phase that starts after the current period holds the plan the person moves to.
async function scheduledChange(
  stripe: Stripe,
  scheduleId: string,
  item: Stripe.SubscriptionItem,
): Promise<SubscriptionState['scheduled']> {
  let schedule: Stripe.SubscriptionSchedule;
  try {
    schedule = await stripe.subscriptionSchedules.retrieve(scheduleId, {
      expand: ['phases.items.price'],
    });
  } catch (cause) {
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Could not read the subscription schedule from Stripe',
      { scheduleId },
      { cause },
    );
  }
  if (schedule.status !== 'active' && schedule.status !== 'not_started') return null;
  const next = schedule.phases.find((phase) => phase.start_date >= item.current_period_end);
  const price = next?.items.at(0)?.price;
  if (!next || !price) return null;
  if (typeof price === 'string' || price.id === item.price.id || 'deleted' in price) return null;
  const choice = planChoiceOfPrice(price);
  return choice
    ? { ...choice, priceId: price.id, startsAt: new Date(next.start_date * 1000) }
    : null;
}

// Seeded plan prices carry their plan, interval and package in metadata.
function planChoiceOfPrice(price: Stripe.Price): PlanChoice | null {
  const { tier, interval, credits } = price.metadata;
  const amount = Number(credits);
  if (!tier || !isPlanTier(tier) || (interval !== 'month' && interval !== 'year')) return null;
  return Number.isInteger(amount) && amount > 0 ? { tier, interval, credits: amount } : null;
}
