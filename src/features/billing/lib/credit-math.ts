// Credit conversion math for usage accrual. Pure constants and functions with no env, DB or SDK
// imports, so the conversion is unit-testable offline and importable by probe scripts.
//
// One credit is CENTS_PER_CREDIT of vendor cost (pricing-config owns the number, next to the
// margin that prices it). A session keeps its exact vendor cost as a running total, and each
// usage event charges the credits that total now owes beyond what the session already paid
// (`creditsDueForSessionTotal`). The rounding up to a whole credit is therefore paid once per
// session, not once per model request, and the tier multipliers hold at every request size.
//
// Money is integer math. Intermediate costs are integer cents-scaled numerators, divided once at
// the end, so float drift cannot round a $1.80 turn up to 181 credits.

import { CENTS_PER_CREDIT } from '../pricing-config';

/**
 * The burn unit lives in pricing-config next to the margin that prices it;
 * re-exported here so accrual code keeps one import for its math.
 */
export { CENTS_PER_CREDIT };

/**
 * Anthropic container runtime surcharge (01-mvp §6.2): $0.08/hr = 8 cents/hr.
 * Exported so the admin Pricing page can state the sandbox rate from the same
 * number the accrual charges, rather than repeating it as a literal.
 */
export const CONTAINER_CENTS_PER_HOUR = 8;

/** The three platform tiers (mirrors features/agents AGENT_TIERS; kept as a
 * local union so this module stays dependency-free).
 * fast → Fast (Haiku), default → Balanced (Sonnet), pro → Expert (Opus). */
export type BillableTier = 'fast' | 'default' | 'pro';

/**
 * Credit cost of a tier relative to Balanced: display framing only — actual
 * accrual uses the per-token pricing below. Values track the real per-token
 * ratios (MODEL_PRICING_CENTS: pro = 400/200 = 2× default, fast = 10/200 =
 * 0.05× on prompts up to the long-prompt threshold; output ratios are identical).
 * These must match the billed ratios so the label never lies about the charge —
 * never inflate them for marketing framing.
 */
export const TIER_CREDIT_MULTIPLIER: Record<BillableTier, number> = {
  fast: 0.05,
  default: 1,
  pro: 2,
};

/**
 * The tier tooltip states the real rate relative to Balanced, read from
 * TIER_CREDIT_MULTIPLIER so the copy cannot drift from the charge.
 */
export function tierCreditRateCopy(tier: BillableTier): string {
  if (tier === 'default') return 'The standard credit rate.';
  return `Uses ${TIER_CREDIT_MULTIPLIER[tier]}x the credits of Balanced.`;
}

export type ModelTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

// CENTS per MILLION tokens, by tier. Rates come from Anthropic's live pricing docs (platform.claude.com):
// Haiku 5.5 $0.10/$0.50 per MTok ($0.50/$2.50 on long prompts), Sonnet 5.5
// $2/$10, and Opus 5.5 $4/$20.
// Cache pricing follows the platform rule: writes 1.25× input (default 5-min
// TTL — Managed Agents caching is automatic), reads 0.1× input; the published
// per-model cache rates match this pro-rata rule exactly.
// Model choice and repricing policy: see STANDING MODEL POLICY in
// features/agents/config.ts — when Anthropic's published rates change, this
// table and everything derived from it get re-verified together.
//
// Inference speed: STANDARD only. All platform agents are seeded with bare
// model strings (features/agents/config.ts), which pins speed "standard" —
// `model_usage.speed: 'fast'` (premium pricing) is unreachable on this
// platform. (Our "fast" TIER is Haiku at standard speed — unrelated to the
// API's `speed: fast` inference mode.) If a fast-mode agent is ever
// introduced, this table needs a speed column before that agent ships, or
// fast-mode turns are under-billed.
export type TokenPricingCents = {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
};

export const MODEL_PRICING_CENTS: Record<BillableTier, TokenPricingCents> = {
  // Fast tier → claude-haiku-5-5, prompts up to HAIKU_LONG_PROMPT_TOKENS
  fast: { inputPerMTok: 10, outputPerMTok: 50, cacheWritePerMTok: 12.5, cacheReadPerMTok: 1 },
  // Balanced tier → claude-sonnet-5-5
  default: { inputPerMTok: 200, outputPerMTok: 1000, cacheWritePerMTok: 250, cacheReadPerMTok: 20 },
  // Expert tier → claude-opus-5-5
  pro: { inputPerMTok: 400, outputPerMTok: 2000, cacheWritePerMTok: 500, cacheReadPerMTok: 40 },
};

// Haiku 5.5 prices each request by its whole prompt, cache reads and writes included.
const HAIKU_LONG_PROMPT_TOKENS = 100_000;
const HAIKU_LONG_PROMPT_CENTS: TokenPricingCents = {
  inputPerMTok: 50,
  outputPerMTok: 250,
  cacheWritePerMTok: 62.5,
  cacheReadPerMTok: 5,
};

function requestPricing(tier: BillableTier, usage: ModelTokenUsage): TokenPricingCents {
  const promptTokens = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
  return tier === 'fast' && promptTokens > HAIKU_LONG_PROMPT_TOKENS
    ? HAIKU_LONG_PROMPT_CENTS
    : MODEL_PRICING_CENTS[tier];
}

const MTOK = 1_000_000;

/** Numerator: cost of one request in (cents × 1e6). */
function tokenCostCentsMTok(p: TokenPricingCents, usage: ModelTokenUsage): number {
  return (
    usage.inputTokens * p.inputPerMTok +
    usage.outputTokens * p.outputPerMTok +
    usage.cacheCreationTokens * p.cacheWritePerMTok +
    usage.cacheReadTokens * p.cacheReadPerMTok
  );
}

function modelRequestCentsMTok(tier: BillableTier, usage: ModelTokenUsage): number {
  return tokenCostCentsMTok(requestPricing(tier, usage), usage);
}

/** Vendor cost in cents for token usage billed outside a platform tier. */
export function tokenUsageCents(pricing: TokenPricingCents, usage: ModelTokenUsage): number {
  return tokenCostCentsMTok(pricing, usage) / MTOK;
}

/** Exact vendor cost in cents of one model request at a tier's published rates. */
export function modelRequestCents(tier: BillableTier, usage: ModelTokenUsage): number {
  return modelRequestCentsMTok(tier, usage) / MTOK;
}

/** Exact vendor cost in cents of a session's cumulative container runtime. */
export function containerRuntimeCents(totalSeconds: number): number {
  return totalSeconds <= 0 ? 0 : (totalSeconds * CONTAINER_CENTS_PER_HOUR) / 3600;
}

/**
 * Credits for any cost measured in vendor cents: tool calls, media and voice
 * generation, and model cost. Margin lives in the credit price and never in
 * the burn. Provider prices are fractional cents (5.3 for a mid square image)
 * and some vendors report dollars x 100 (0.07 * 100 is 7.000000000000001), so
 * the cents rescale to an integer numerator before the single division. A
 * residue under 0.0005 cents never costs a credit.
 */
export function creditsForVendorCents(vendorCostCents: number): number {
  if (vendorCostCents <= 0) return 0;
  const scaledCents = Math.round(vendorCostCents * 1000);
  return Math.ceil(scaledCents / (CENTS_PER_CREDIT * 1000));
}

/**
 * The one charging rule for usage that belongs to a session: the credits the session's exact
 * vendor total owes, less the credits it was already charged. Never negative.
 */
export function creditsDueForSessionTotal(
  vendorCentsAfter: number,
  creditsConsumedBefore: number,
): number {
  return Math.max(0, creditsForVendorCents(vendorCentsAfter) - creditsConsumedBefore);
}
