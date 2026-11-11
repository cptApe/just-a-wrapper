import { BillingError } from '@/lib/errors';
import { requireStripe } from '@/lib/stripe';
import 'server-only';
import { releaseSchedule } from './change-plan';
import { assertPlansOnSale } from './get-plan-options';
import type { ActiveWorkspace } from './resolve-workspace';
import { idOfExpandable } from './retrieve-current-subscription';
import { loadSubscription } from './subscription-state';

// Cancelling keeps the plan until the period the person paid for ends; Stripe then deletes the
// subscription and its webhook ends the plan and retires its credits. Bought credits stay.
export async function cancelPlan(input: {
  workspace: ActiveWorkspace;
  resume: boolean;
}): Promise<{ cancelsAt: string | null }> {
  const { workspace, resume } = input;
  await assertPlansOnSale(workspace.id);
  const subscriptionId = workspace.stripeSubscriptionId;
  if (!subscriptionId) {
    throw new BillingError('VALIDATION_FAILED', 'This workspace has no plan to cancel.', {
      workspaceId: workspace.id,
    });
  }
  const stripe = requireStripe();
  const { subscription, state } = await loadSubscription(stripe, subscriptionId);
  if (resume === (state.cancelsAt === null))
    return { cancelsAt: state.cancelsAt?.toISOString() ?? null };
  // A waiting plan change ends with the cancellation, so a resumed plan renews as it is.
  const scheduleId = idOfExpandable(subscription.schedule);
  if (!resume && scheduleId) await releaseSchedule(stripe, scheduleId);
  try {
    // A cancel date set in the portal is a cancel_at without cancel_at_period_end.
    const resumeParams = subscription.cancel_at_period_end
      ? { cancel_at_period_end: false }
      : { cancel_at: '' as const };
    const updated = await stripe.subscriptions.update(
      subscription.id,
      resume ? resumeParams : { cancel_at_period_end: true },
    );
    const end =
      updated.cancel_at ??
      (updated.cancel_at_period_end ? updated.items.data.at(0)?.current_period_end : null);
    return { cancelsAt: end ? new Date(end * 1000).toISOString() : null };
  } catch (cause) {
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      resume ? 'Could not resume the plan in Stripe' : 'Could not cancel the plan in Stripe',
      { subscriptionId },
      { cause },
    );
  }
}
