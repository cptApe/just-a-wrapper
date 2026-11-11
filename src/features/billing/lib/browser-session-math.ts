import { type TokenPricingCents, tokenUsageCents } from './credit-math';

const BROWSERBASE_CENTS_PER_HOUR = 12;
// Published Haiku 4.5 rates, the model in STAGEHAND_MODEL.
const STAGEHAND_PRICING_CENTS: TokenPricingCents = {
  inputPerMTok: 100,
  outputPerMTok: 500,
  cacheWritePerMTok: 125,
  cacheReadPerMTok: 10,
};
const BROWSER_SESSION_MIN_SECONDS = 60;
export const BROWSER_SESSION_MAX_SECONDS = 3600;

export type StagehandTokenMetrics = {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalReasoningTokens: number;
  totalCachedInputTokens: number;
};

export function browserSessionVendorCostCents(durationSeconds: number): number {
  return (
    (Math.max(BROWSER_SESSION_MIN_SECONDS, durationSeconds) / 3600) * BROWSERBASE_CENTS_PER_HOUR
  );
}

export function stagehandInferenceVendorCostCents(metrics: StagehandTokenMetrics): number {
  return tokenUsageCents(STAGEHAND_PRICING_CENTS, {
    inputTokens: Math.max(0, metrics.totalPromptTokens),
    outputTokens: Math.max(0, metrics.totalCompletionTokens + metrics.totalReasoningTokens),
    cacheCreationTokens: 0,
    cacheReadTokens: Math.max(0, metrics.totalCachedInputTokens),
  });
}

export function stagehandCostDeltaMicros(input: {
  metricsBeforeMicros: number;
  metricsAfterMicros: number | null;
  fallbackMicros: number;
}): { vendorCostMicros: number; estimated: boolean } {
  const baselineMicros = input.metricsBeforeMicros;
  const measuredDeltaMicros =
    input.metricsAfterMicros === null ? 0 : input.metricsAfterMicros - baselineMicros;
  if (input.metricsAfterMicros !== null && measuredDeltaMicros >= 0) {
    return {
      vendorCostMicros: measuredDeltaMicros,
      estimated: false,
    };
  }
  return {
    vendorCostMicros: input.fallbackMicros,
    estimated: true,
  };
}

/** Clamp Browserbase wall-clock billing to the persisted start and v1's hard
 * one-hour cap. A delayed sweep must never turn scheduler lag into user spend. */
export function cappedBrowserSessionEnd(startedAt: Date, candidateEndedAt: Date): Date {
  const startMs = startedAt.getTime();
  const cappedMs = Math.min(
    Math.max(candidateEndedAt.getTime(), startMs),
    startMs + BROWSER_SESSION_MAX_SECONDS * 1000,
  );
  return new Date(cappedMs);
}

export function browserSessionBillingKey(browserbaseSessionId: string): string {
  return `browser-session:${browserbaseSessionId}`;
}
