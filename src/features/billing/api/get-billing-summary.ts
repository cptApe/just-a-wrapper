import { memberCreditPeriodStart } from '../lib/credit-grants';
import { expiresAtMonthsAfter } from '../pricing-config';
import 'server-only';
import { PLANS, type PlanLimits, type PlanTier, type WorkspacePlan } from '../pricing-config';
import { getCurrentPlanCreditsExpireAt, getLiveCreditBalance } from './credit-ledger';
import { getPlanBilling, type NextBill } from './get-plan-billing';
import { billingTerms, planLimits } from './plan-limits';
import { type ActiveWorkspace, resolveActiveWorkspace } from './resolve-workspace';

const NO_PLAN_NAME = 'No plan';

export type BillingSummary = {
  workspaceId: string;
  workspaceName: string;
  creditBalance: number;
  creditResetAt: Date | null;
  planCreditsExpireAt: Date | null;
  planTier: WorkspacePlan;
  planCredits: number | null;
  planLimits: PlanLimits;
  autoTopup: {
    enabled: boolean;
    thresholdCredits: number;
    topupCredits: number;
    monthlyCapCents: number;
  };
  isSubscribed: boolean;
  hasCustomer: boolean;
  planName: string;
  planPriceCents?: number | null;
  planPriceCurrency?: string;
  planInterval?: string;
  nextBill?: NextBill;
  /** Plans are bought and changed in the app on this deployment. */
  sellsPlans: boolean;
  /** The subscription's state in Stripe; absent without a plan or when Stripe cannot be read. */
  subscription?: {
    pastDue: boolean;
    cancelsAt: Date | null;
    scheduledChange: { tier: PlanTier; credits: number; startsAt: Date } | null;
  };
};

/** Member-level: any live member may read the plan and balance. */
export async function getBillingSummary(headers: Headers): Promise<BillingSummary> {
  return summarizeBilling(await resolveActiveWorkspace(headers));
}

export async function summarizeBilling(workspace: ActiveWorkspace): Promise<BillingSummary> {
  const [creditBalance, planCreditsExpireAt, terms] = await Promise.all([
    getLiveCreditBalance(workspace.id),
    getCurrentPlanCreditsExpireAt(workspace.id),
    billingTerms(),
  ]);
  const cycleStart = memberCreditPeriodStart({
    planTier: workspace.planTier,
    creditResetAt: workspace.creditResetAt,
    now: new Date(),
  });
  const anchor = workspace.creditResetAt;
  const nextReset =
    anchor === null
      ? null
      : expiresAtMonthsAfter(
          anchor,
          (cycleStart.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
            cycleStart.getUTCMonth() -
            anchor.getUTCMonth() +
            1,
        );
  const base: BillingSummary = {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    creditBalance,
    creditResetAt: nextReset,
    planCreditsExpireAt,
    planTier: workspace.planTier,
    planCredits: workspace.planCredits,
    planLimits: await planLimits(workspace.planTier),
    autoTopup: {
      enabled: workspace.autoTopupEnabled,
      thresholdCredits: workspace.autoTopupThresholdCredits,
      topupCredits: workspace.autoTopupCredits,
      monthlyCapCents: workspace.autoTopupMonthlyCapCents,
    },
    isSubscribed: Boolean(workspace.stripeSubscriptionId),
    hasCustomer: Boolean(workspace.stripeCustomerId),
    planName: workspace.planTier === 'none' ? NO_PLAN_NAME : PLANS[workspace.planTier].name,
    sellsPlans: terms.kind === 'stripe' && terms.rules.sellsPlans,
  };

  if (!workspace.stripeSubscriptionId) {
    return base;
  }

  const plan = await getPlanBilling(workspace);
  if (!plan) {
    return base;
  }

  // A null flat price represents tiered or metered billing; never invent a zero charge.
  return {
    ...base,
    planPriceCents: plan.planPriceCents,
    planPriceCurrency: plan.planPriceCurrency,
    planInterval: plan.planInterval,
    nextBill: plan.nextBill,
    subscription: {
      pastDue: plan.state.status === 'past_due',
      cancelsAt: plan.state.cancelsAt,
      scheduledChange: plan.state.scheduled && {
        tier: plan.state.scheduled.tier,
        credits: plan.state.scheduled.credits,
        startsAt: plan.state.scheduled.startsAt,
      },
    },
  };
}
