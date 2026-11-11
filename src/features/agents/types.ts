// Platform agent types mirror Anthropic Managed Agents resources.
// Internal tier ids stay stable on session rows and in environment variables.
// User-facing labels are Fast, Balanced and Expert, never model names.
export type AgentTier = 'fast' | 'default' | 'pro';

// The pre-built agent toolset version.
export const AGENT_TOOLSET_TYPE = 'agent_toolset_20260401' as const;

export type AgentTierConfig = {
  tier: AgentTier;
  /** Human label shown wherever a tier is picked. */
  label: string;
  /** Anthropic model ID. Bare string → speed "standard" (verified). */
  model: string;
  /** Whether the model accepts system.message events. Supported tiers send
   * grounding there; other tiers embed session_context and current_time in user text. */
  supportsSystemMessages: boolean;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};
