// Credits-only mode: one-time credits, no plans for sale. A workspace without a plan gets the top
// plan's limits, because buying credits unlocks the whole product. Workspaces that already have a
// subscription keep it read-only, with auto top-up, the Stripe portal and every webhook handler.
// To remove this mode, follow decision 0047: delete this folder, remove 'credits_only' from
// BILLING_MODES, delete its line in lib/billing-mode-rules.ts, then run pnpm verify.
import type { BillingModeRules } from '../lib/billing-mode-rules';
import { PLANS } from '../pricing-config';

export const CREDITS_ONLY_RULES: BillingModeRules = {
  sellsPlans: false,
  noPlanLimits: PLANS.max.limits,
};
