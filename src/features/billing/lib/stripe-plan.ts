import { formatCount } from '@/lib/format/format-number';
import { PLAN_PRODUCT_IDS, planLookupKey, planPriceMetadata } from '../catalog';
import {
  BILLING_INTERVALS,
  type BillingInterval,
  PLAN_TIERS,
  PLANS,
  type PlanTier,
  packagesForPlan,
  planAmountCents,
} from '../pricing-config';

export type IntendedPrice = {
  lookupKey: string;
  productId: string;
  unitAmountCents: number;
  credits: number;
  nickname: string;
  metadata: Record<string, string>;
  kind: 'plan';
  tier: PlanTier;
  interval: BillingInterval;
};

// The seed and reconciliation share this catalog; top-ups use inline totals rather than persistent prices.
export function buildIntendedCatalog(): IntendedPrice[] {
  return PLAN_TIERS.flatMap((tier) =>
    BILLING_INTERVALS.flatMap((interval) =>
      packagesForPlan(tier).map((credits) => ({
        lookupKey: planLookupKey(tier, interval, credits),
        productId: PLAN_PRODUCT_IDS[tier],
        unitAmountCents: planAmountCents(credits, interval),
        credits,
        nickname: `${PLANS[tier].name}, ${formatCount(credits)} credits a month`,
        kind: 'plan' as const,
        tier,
        interval,
        metadata: planPriceMetadata(tier, interval, credits),
      })),
    ),
  );
}
