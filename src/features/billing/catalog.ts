import { BILLING_CURRENCY, type BillingInterval, type PlanTier } from './pricing-config';

export const CURRENCY = BILLING_CURRENCY;
export const PLAN_PRODUCT_IDS: Record<PlanTier, string> = {
  pro: 'just_a_wrapper_plan_pro',
  max: 'just_a_wrapper_plan_max',
};
export const TOPUP_PRODUCT_ID = 'just_a_wrapper_credit_topup';

export function planLookupKey(tier: PlanTier, interval: BillingInterval, credits: number): string {
  return `plan_${tier}_${interval}_${credits}`;
}

export function planPriceMetadata(
  tier: PlanTier,
  interval: BillingInterval,
  credits: number,
): Record<string, string> {
  return { kind: 'plan', tier, interval, credits: String(credits), block_credits: String(credits) };
}
