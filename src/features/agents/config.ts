import type { AgentTier, AgentTierConfig } from './types';

// STANDING MODEL POLICY: Fast / Balanced / Expert use the latest Anthropic Managed Agents models.
// Pinned IDs require manual updates and re-seeding for each replacement release.
// Consult artificialanalysis.ai; choose by price per task for the tier, not per token.
// Update published rates here, billing MODEL_PRICING_CENTS, TIER_CREDIT_MULTIPLIER, tooltips and docs together.
// Check supportsSystemMessages live through the app whenever a model changes.
// Model names are set per deployment; seed MCP servers only when the proxy URL is configured.
export const AGENT_TIERS: Record<AgentTier, AgentTierConfig> = {
  fast: {
    tier: 'fast',
    label: 'Fast (Haiku 5.5)',
    model: 'claude-haiku-5-5',
    supportsSystemMessages: true,
  },
  default: {
    tier: 'default',
    label: 'Balanced (Sonnet 5.5)',
    model: 'claude-sonnet-5-5',
    supportsSystemMessages: true,
  },
  pro: {
    tier: 'pro',
    label: 'Expert (Opus 5.5)',
    model: 'claude-opus-5-5',
    supportsSystemMessages: true,
  },
};

/** Whether a tier's model accepts `system.message` events (grounding channel). */
export function tierSupportsSystemMessages(tier: AgentTier): boolean {
  return AGENT_TIERS[tier].supportsSystemMessages;
}

export const AGENT_TIER_LIST: AgentTierConfig[] = [
  AGENT_TIERS.fast,
  AGENT_TIERS.default,
  AGENT_TIERS.pro,
];

/** User-facing tier copy — the ONLY place tier labels/descriptions live. Users
 * see Fast/Balanced/Expert, never model names. Descriptions are capability-only;
 * credit-cost copy lives in `tierCreditRateCopy` (billing/lib/credit-math) and
 * is surfaced on hover, never inline (an owner decision). */
export const TIER_DISPLAY: Record<AgentTier, { label: string; description: string }> = {
  fast: {
    label: 'Fast',
    description: 'For quick, simple tasks.',
  },
  default: {
    label: 'Balanced',
    description: 'The right choice for most work.',
  },
  pro: {
    label: 'Expert',
    description: 'For the hardest and longest work.',
  },
};

// Stable, environment-scoped agent names. The seed script is idempotent by
// name: it looks for an existing agent with this name in the current workspace
// before creating a new one, so re-running never accumulates duplicates. The
// VERCEL_ENV suffix keeps preview and prod agents distinct within one org/
// workspace (agents are per-environment because the
// MCP-proxy URL is baked in at create time).
export function agentName(tier: AgentTier, deployEnv: string): string {
  return `just-a-wrapper/${tier}/${deployEnv}`;
}

export function environmentName(deployEnv: string): string {
  return `just-a-wrapper/${deployEnv}`;
}
