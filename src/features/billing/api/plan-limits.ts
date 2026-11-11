import 'server-only';
import { billingCapability } from '@/lib/runtime-capabilities';
import { type BillingModeRules, billingModeRules } from '../lib/billing-mode-rules';
import type { LimitRefusal } from '../lib/plan-gates';
import {
  PLANS,
  type PlanLimits,
  TOP_PLAN_TIER,
  UNLIMITED_PLAN_LIMITS,
  type WorkspacePlan,
} from '../pricing-config';

/** Billing as limits see it: off, or on with the rules of the current mode. */
export type BillingTerms = { kind: 'off' } | { kind: 'stripe'; rules: BillingModeRules };

export async function billingTerms(): Promise<BillingTerms> {
  const billing = await billingCapability();
  return billing.kind === 'off'
    ? { kind: 'off' }
    : { kind: 'stripe', rules: billingModeRules(billing.mode) };
}

function limitsUnder(plan: WorkspacePlan, terms: BillingTerms): PlanLimits {
  if (terms.kind === 'off') return UNLIMITED_PLAN_LIMITS;
  return plan === 'none' ? terms.rules.noPlanLimits : PLANS[plan].limits;
}

/** A refusal points at a bigger plan only where plans are sold and one exists. */
function biggerPlanOnSale(plan: WorkspacePlan, terms: BillingTerms): boolean {
  return terms.kind === 'stripe' && terms.rules.sellsPlans && plan !== TOP_PLAN_TIER;
}

/** A workspace's limits, and whether a refusal at one may point at a bigger plan. */
export async function limitRefusal(plan: WorkspacePlan): Promise<LimitRefusal> {
  const terms = await billingTerms();
  return { limits: limitsUnder(plan, terms), biggerPlan: biggerPlanOnSale(plan, terms) };
}

export async function planLimits(plan: WorkspacePlan): Promise<PlanLimits> {
  return limitsUnder(plan, await billingTerms());
}
