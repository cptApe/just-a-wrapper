import { BillingError } from '@/lib/errors';
import { requireStripe } from '@/lib/stripe';
import 'server-only';
import Stripe from 'stripe';
import { type PlanChoice, type PlanPack, planChangeTiming } from '../lib/plan-picker-packs';
import { isPlanTier, type PlanTier } from '../pricing-config';
import { assertPlansOnSale } from './get-plan-options';
import { listPlanPrices, requirePlanPack } from './list-plan-prices';
import type { ActiveWorkspace } from './resolve-workspace';
import { idOfExpandable } from './retrieve-current-subscription';
import { type LoadedSubscription, loadSubscription } from './subscription-state';

export type PlanChangePreview = { amountCents: number; currency: string; prorationDate: number };
export type PlanChangeResult = { effective: 'now' | 'next_renewal' };
export type PlanChargeConfirmation = { prorationDate: number; amountCents: number };

// The browser returns the proration date it was shown, so its age is bounded: a backdated date
// would shrink the charge.
const CONFIRMATION_MAX_AGE_SECONDS = 15 * 60;
const CONFIRMATION_CLOCK_SKEW_SECONDS = 60;

type Target = {
  stripe: Stripe;
  loaded: LoadedSubscription;
  pack: PlanPack;
  timing: 'now' | 'next_renewal';
};

async function resolveTarget(workspace: ActiveWorkspace, choice: PlanChoice): Promise<Target> {
  await assertPlansOnSale(workspace.id);
  const subscriptionId = workspace.stripeSubscriptionId;
  if (!subscriptionId || !isPlanTier(workspace.planTier)) {
    throw new BillingError('VALIDATION_FAILED', 'This workspace has no plan to change.', {
      workspaceId: workspace.id,
    });
  }
  const stripe = requireStripe();
  const [packs, loaded] = await Promise.all([
    listPlanPrices(),
    loadSubscription(stripe, subscriptionId),
  ]);
  const pack = requirePlanPack(packs, choice);
  if (loaded.item.price.id === pack.priceId) {
    throw new BillingError('VALIDATION_FAILED', 'You are already on this plan.', {
      workspaceId: workspace.id,
    });
  }
  const current = currentPlanOf(loaded, workspace.planTier);
  return { stripe, loaded, pack, timing: planChangeTiming(current, toTarget(pack)) };
}

function currentPlanOf(loaded: LoadedSubscription, tier: PlanTier) {
  const { price, quantity } = loaded.item;
  return {
    tier,
    interval: price.recurring?.interval === 'year' ? ('year' as const) : ('month' as const),
    amountCents: price.unit_amount === null ? null : price.unit_amount * (quantity ?? 1),
  };
}

function toTarget(pack: PlanPack) {
  return { tier: pack.tier, interval: pack.interval, amountCents: pack.unitAmount };
}

/** The exact amount Stripe charges now for a change that starts now. */
export async function previewPlanChange(input: {
  workspace: ActiveWorkspace;
  choice: PlanChoice;
}): Promise<PlanChangePreview> {
  const target = await resolveTarget(input.workspace, input.choice);
  if (target.timing !== 'now') {
    throw new BillingError('VALIDATION_FAILED', 'This change starts at your next renewal.', {
      workspaceId: input.workspace.id,
    });
  }
  const prorationDate = Math.floor(Date.now() / 1_000);
  const invoice = await previewCharge(target, prorationDate);
  return { amountCents: invoice.amount_due, currency: invoice.currency, prorationDate };
}

/**
 * A change that starts now charges the difference on the saved card and leaves the plan as it was
 * if the card fails. A change that starts at renewal is a schedule phase and charges nothing now.
 * Either way the paid invoice, through the webhook, changes the plan row and grants credits.
 */
export async function changePlan(input: {
  workspace: ActiveWorkspace;
  choice: PlanChoice;
  confirmation?: PlanChargeConfirmation;
}): Promise<PlanChangeResult> {
  const target = await resolveTarget(input.workspace, input.choice);
  if (target.timing === 'now') {
    const confirmation = await confirmedCharge(target, input.confirmation);
    await upgradeNow(target, confirmation);
    return { effective: 'now' };
  }
  await scheduleAtRenewal(target);
  return { effective: 'next_renewal' };
}

// These parameters mirror the update in upgradeNow, so the preview is the invoice it creates.
async function previewCharge(target: Target, prorationDate: number): Promise<Stripe.Invoice> {
  const { stripe, loaded, pack } = target;
  try {
    return await stripe.invoices.createPreview({
      subscription: loaded.subscription.id,
      subscription_details: {
        items: [{ id: loaded.item.id, price: pack.priceId, quantity: 1 }],
        proration_behavior: 'always_invoice',
        proration_date: prorationDate,
      },
    });
  } catch (cause) {
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Could not preview the plan change in Stripe',
      { subscriptionId: loaded.subscription.id },
      { cause },
    );
  }
}

async function confirmedCharge(
  target: Target,
  confirmation: PlanChargeConfirmation | undefined,
): Promise<PlanChargeConfirmation> {
  const subscriptionId = target.loaded.subscription.id;
  if (!confirmation) {
    throw new BillingError('VALIDATION_FAILED', 'Confirm the amount before you pay.', {
      subscriptionId,
    });
  }
  const ageSeconds = Math.floor(Date.now() / 1_000) - confirmation.prorationDate;
  if (ageSeconds > CONFIRMATION_MAX_AGE_SECONDS || ageSeconds < -CONFIRMATION_CLOCK_SKEW_SECONDS) {
    throw new BillingError('VALIDATION_FAILED', 'This price expired. Close this and try again.', {
      subscriptionId,
      ageSeconds,
    });
  }
  const invoice = await previewCharge(target, confirmation.prorationDate);
  if (invoice.amount_due !== confirmation.amountCents) {
    throw new BillingError('VALIDATION_FAILED', 'The price changed. Close this and try again.', {
      subscriptionId,
      confirmedCents: confirmation.amountCents,
      currentCents: invoice.amount_due,
    });
  }
  return confirmation;
}

async function upgradeNow(target: Target, confirmation: PlanChargeConfirmation): Promise<void> {
  const { stripe, loaded, pack } = target;
  const { subscription } = loaded;
  // A waiting downgrade would undo this upgrade at renewal, so it goes first.
  const scheduleId = idOfExpandable(subscription.schedule);
  const schedule = scheduleId ? await releaseSchedule(stripe, scheduleId) : null;
  try {
    await stripe.subscriptions.update(
      subscription.id,
      {
        items: [{ id: loaded.item.id, price: pack.priceId, quantity: 1 }],
        proration_behavior: 'always_invoice',
        proration_date: confirmation.prorationDate,
        // A failed payment leaves the plan unchanged and returns the reason instead of past due.
        payment_behavior: 'error_if_incomplete',
        // Choosing a plan means staying, so a pending cancellation ends here.
        ...(subscription.cancel_at_period_end ? { cancel_at_period_end: false } : {}),
      },
      {
        idempotencyKey: `plan-upgrade:${subscription.id}:${pack.priceId}:${confirmation.prorationDate}`,
      },
    );
  } catch (cause) {
    if (schedule) await restoreSchedule(stripe, subscription.id, schedule);
    throw upgradeFailure(cause, subscription.id);
  }
}

async function scheduleAtRenewal(target: Target): Promise<void> {
  const { stripe, loaded, pack } = target;
  const { subscription, item } = loaded;
  try {
    if (subscription.cancel_at_period_end) {
      await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: false });
    }
    const scheduleId = idOfExpandable(subscription.schedule);
    const schedule = scheduleId
      ? await stripe.subscriptionSchedules.retrieve(scheduleId)
      : await stripe.subscriptionSchedules.create(
          { from_subscription: subscription.id },
          { idempotencyKey: `plan-schedule:${subscription.id}:${item.current_period_end}` },
        );
    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: 'release',
      proration_behavior: 'none',
      phases: [
        {
          start_date: item.current_period_start,
          end_date: item.current_period_end,
          items: [{ price: item.price.id, quantity: item.quantity ?? 1 }],
          proration_behavior: 'none',
        },
        {
          start_date: item.current_period_end,
          duration: { interval: pack.interval, interval_count: 1 },
          items: [{ price: pack.priceId, quantity: 1 }],
          proration_behavior: 'none',
        },
      ],
    });
  } catch (cause) {
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Could not schedule the plan change in Stripe',
      { subscriptionId: subscription.id, priceId: pack.priceId },
      { cause },
    );
  }
}

/** Ends a waiting plan change; the subscription keeps renewing on its current plan. */
export async function releaseSchedule(
  stripe: Stripe,
  scheduleId: string,
): Promise<Stripe.SubscriptionSchedule> {
  try {
    const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
    if (schedule.status === 'active' || schedule.status === 'not_started')
      await stripe.subscriptionSchedules.release(schedule.id);
    return schedule;
  } catch (cause) {
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Could not release the plan schedule in Stripe',
      { scheduleId },
      { cause },
    );
  }
}

// A failed upgrade must not silently drop the downgrade the person had already chosen.
async function restoreSchedule(
  stripe: Stripe,
  subscriptionId: string,
  schedule: Stripe.SubscriptionSchedule,
): Promise<void> {
  const restored = await stripe.subscriptionSchedules.create(
    { from_subscription: subscriptionId },
    { idempotencyKey: `restore-plan-schedule:${schedule.id}` },
  );
  const now = Math.floor(Date.now() / 1000);
  await stripe.subscriptionSchedules.update(restored.id, {
    end_behavior: schedule.end_behavior,
    proration_behavior: 'none',
    phases: schedule.phases
      .filter((phase) => phase.end_date > now)
      .map((phase) => ({
        start_date: phase.start_date,
        end_date: phase.end_date,
        items: phase.items.map((phaseItem) => ({
          price: typeof phaseItem.price === 'string' ? phaseItem.price : phaseItem.price.id,
          quantity: phaseItem.quantity ?? 1,
        })),
        proration_behavior: 'none',
      })),
  });
}

// Stripe writes card error messages for customers, so a decline shows its own reason.
function upgradeFailure(cause: unknown, subscriptionId: string): BillingError {
  if (cause instanceof Stripe.errors.StripeCardError) {
    return new BillingError('VALIDATION_FAILED', cause.message, { subscriptionId }, { cause });
  }
  if (cause instanceof Stripe.errors.StripeError && cause.statusCode === 402) {
    return new BillingError(
      'VALIDATION_FAILED',
      'Your card could not be charged. Nothing changed. Try another card.',
      { subscriptionId },
      { cause },
    );
  }
  return new BillingError(
    'EXTERNAL_API_FAILED',
    'Could not change the plan in Stripe',
    { subscriptionId },
    { cause },
  );
}
