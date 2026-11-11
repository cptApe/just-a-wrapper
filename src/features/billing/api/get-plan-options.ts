import { BillingError } from '@/lib/errors';
import { requireStripe } from '@/lib/stripe';
import 'server-only';
import type { CurrentPlan, PlanChoice, PlanPack } from '../lib/plan-picker-packs';
import { isPlanTier } from '../pricing-config';
import { listPlanPrices } from './list-plan-prices';
import { billingTerms } from './plan-limits';
import type { ActiveWorkspace } from './resolve-workspace';
import { loadSubscription } from './subscription-state';

export type PlanOptions = {
  packs: PlanPack[];
  current: CurrentPlan | null;
  /** ISO dates, so the browser formats them in the person's zone. */
  renewsAt: string | null;
  cancelsAt: string | null;
  scheduled: (PlanChoice & { startsAt: string }) | null;
  pastDue: boolean;
};

/** Plans are bought and changed in the app only where the billing mode sells them. */
export async function assertPlansOnSale(workspaceId: string): Promise<void> {
  const terms = await billingTerms();
  if (terms.kind === 'stripe' && terms.rules.sellsPlans) return;
  throw new BillingError('VALIDATION_FAILED', 'Plans are not sold on this deployment.', {
    workspaceId,
  });
}

export async function getPlanOptions(workspace: ActiveWorkspace): Promise<PlanOptions> {
  await assertPlansOnSale(workspace.id);
  const packs = await listPlanPrices();
  const none: PlanOptions = {
    packs,
    current: null,
    renewsAt: null,
    cancelsAt: null,
    scheduled: null,
    pastDue: false,
  };
  if (!workspace.stripeSubscriptionId || !isPlanTier(workspace.planTier)) return none;
  const { item, state } = await loadSubscription(requireStripe(), workspace.stripeSubscriptionId);
  return {
    packs,
    current: {
      tier: workspace.planTier,
      interval: workspace.planBillingInterval ?? 'month',
      credits: workspace.planCredits,
      amountCents:
        item.price.unit_amount === null ? null : item.price.unit_amount * (item.quantity ?? 1),
    },
    renewsAt: state.periodEnd?.toISOString() ?? null,
    cancelsAt: state.cancelsAt?.toISOString() ?? null,
    scheduled: state.scheduled
      ? {
          tier: state.scheduled.tier,
          interval: state.scheduled.interval,
          credits: state.scheduled.credits,
          startsAt: state.scheduled.startsAt.toISOString(),
        }
      : null,
    pastDue: state.status === 'past_due',
  };
}
