import type { ModelTokenUsage } from './credit-math';

export function usageReconciliationDelta(
  snapshot: ModelTokenUsage,
  billed: ModelTokenUsage,
): ModelTokenUsage {
  return {
    inputTokens: Math.max(0, snapshot.inputTokens - billed.inputTokens),
    outputTokens: Math.max(0, snapshot.outputTokens - billed.outputTokens),
    cacheCreationTokens: Math.max(0, snapshot.cacheCreationTokens - billed.cacheCreationTokens),
    cacheReadTokens: Math.max(0, snapshot.cacheReadTokens - billed.cacheReadTokens),
  };
}
