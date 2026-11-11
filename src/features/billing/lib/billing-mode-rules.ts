import type { BillingMode } from '@/lib/deployment-settings/registry';
// The one import of the credits-only module (decision 0047 lists the steps to delete it).
import { CREDITS_ONLY_RULES } from '../credits-only/rules';
import { NO_PLAN_LIMITS, type PlanLimits } from '../pricing-config';

/** What a billing mode changes. Code asks these rules, never the mode's name. */
export type BillingModeRules = {
  /**
   * Plans are bought, changed and cancelled in the app; `pnpm seed:stripe` creates their prices
   * and the admin console checks them. Without it, existing subscribers keep a read-only plan.
   */
  sellsPlans: boolean;
  /** The limits of a workspace with no plan. */
  noPlanLimits: PlanLimits;
};

const SUBSCRIPTION_RULES: BillingModeRules = { sellsPlans: true, noPlanLimits: NO_PLAN_LIMITS };

const RULES: Record<BillingMode, BillingModeRules> = {
  subscriptions: SUBSCRIPTION_RULES,
  credits_only: CREDITS_ONLY_RULES,
};

export function billingModeRules(mode: BillingMode): BillingModeRules {
  return RULES[mode];
}

/** Whether plans can be bought in the app, for billing as the capabilities module resolves it. */
export function plansForSale(billing: { kind: 'off' } | { kind: 'stripe'; mode: BillingMode }) {
  return billing.kind === 'stripe' && RULES[billing.mode].sellsPlans;
}
