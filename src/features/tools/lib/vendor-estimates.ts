import { browserSessionVendorCostCents } from '@/features/billing/lib/browser-session-math';
import { creditsForVendorCents } from '@/features/billing/lib/credit-math';
import { MIN_TURN_CREDITS } from '@/features/billing/pricing-config';

// Spend estimates for tools whose one call costs about a cent. Each needs the gate's one-credit
// floor on hand; the measured cost is charged after delivery.

/** A new browser bills at least the provider's one-minute minimum. */
export function browserStartEstimateCredits(): number {
  return creditsForVendorCents(browserSessionVendorCostCents(0));
}

/** One Exa request (about half a cent) or one Stagehand action (about a cent). */
export function vendorCallEstimateCredits(): number {
  return MIN_TURN_CREDITS;
}
