import { BillingError } from '@/lib/errors';
import { requireStripe } from '@/lib/stripe';
import 'server-only';
import { PLAN_PRODUCT_IDS, planLookupKey } from '../catalog';
import { findPack, type PlanChoice, type PlanPack } from '../lib/plan-picker-packs';
import { BILLING_INTERVALS, PLAN_TIERS, packagesForPlan } from '../pricing-config';

// Stripe's own prices are what the dialog shows and what checkout charges, so the two agree.
// Only prices `pnpm seed:stripe` made from the current catalog count.
export async function listPlanPrices(): Promise<PlanPack[]> {
  const stripe = requireStripe();
  const packs: PlanPack[] = [];
  try {
    for (const tier of PLAN_TIERS) {
      for await (const price of stripe.prices.list({
        product: PLAN_PRODUCT_IDS[tier],
        active: true,
        limit: 100,
      })) {
        const interval = BILLING_INTERVALS.find((value) => value === price.metadata.interval);
        const credits = Number(price.metadata.credits);
        if (
          !interval ||
          price.metadata.kind !== 'plan' ||
          price.metadata.tier !== tier ||
          !packagesForPlan(tier).includes(credits) ||
          price.metadata.block_credits !== String(credits) ||
          price.lookup_key !== planLookupKey(tier, interval, credits) ||
          price.recurring?.interval !== interval ||
          price.unit_amount == null
        )
          continue;
        packs.push({
          tier,
          interval,
          credits,
          priceId: price.id,
          unitAmount: price.unit_amount,
          currency: price.currency,
        });
      }
    }
  } catch (cause) {
    throw new BillingError('EXTERNAL_API_FAILED', 'Could not list plan prices', {}, { cause });
  }
  return packs.sort(
    (a, b) =>
      PLAN_TIERS.indexOf(a.tier) - PLAN_TIERS.indexOf(b.tier) ||
      BILLING_INTERVALS.indexOf(a.interval) - BILLING_INTERVALS.indexOf(b.interval) ||
      a.credits - b.credits,
  );
}

export function requirePlanPack(packs: readonly PlanPack[], choice: PlanChoice): PlanPack {
  const pack = findPack(packs, choice);
  if (!pack) {
    throw new BillingError('VALIDATION_FAILED', 'That plan and credit package is not for sale.', {
      ...choice,
    });
  }
  return pack;
}
