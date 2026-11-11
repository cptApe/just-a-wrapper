import 'server-only';
import { cache } from 'react';
import { getAnthropicClient, requireAgentId } from '@/features/agents/api/anthropic-client';
import { AGENT_TIER_LIST, AGENT_TIERS } from '@/features/agents/config';
import type { AgentTier } from '@/features/agents/types';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { capabilities } from '@/lib/runtime-capabilities';
import { diffAgent, diffEnvironment, type LiveEnvironmentConfig } from '../lib/seed-diff';
import { buildSeedPlanFromCapabilities, type SeedPlan } from '../seed-plan';

// Read-only indicator: absent configuration or network failure yields unknown,
// so the admin page never depends on Anthropic being reachable.
type AgentConfigDrift =
  | { kind: 'in-sync' }
  | { kind: 'drifted'; fields: string[] }
  | { kind: 'unknown'; reason: string };
export type TierConfigDrift = { tier: AgentTier; label: string; state: AgentConfigDrift };

function unknownTiers(reason: string): TierConfigDrift[] {
  return AGENT_TIER_LIST.map(({ tier, label }) => ({
    tier,
    label,
    state: { kind: 'unknown', reason },
  }));
}

// Resolve before the network call: INTEGRATION_NOT_CONNECTED from Anthropic
// is a real failure, not evidence that this tier was never seeded.
function agentIdOrNullWhenUnseeded(tier: AgentTier): string | null {
  try {
    return requireAgentId(tier);
  } catch (error) {
    if (error instanceof AppError && error.code === 'INTEGRATION_NOT_CONNECTED') return null;
    throw error;
  }
}

async function driftForTier(
  planned: SeedPlan['agents'][number],
  client: NonNullable<ReturnType<typeof getAnthropicClient>>,
  environmentFields: string[],
): Promise<TierConfigDrift> {
  const base = { tier: planned.slug, label: AGENT_TIERS[planned.slug].label };
  const agentId = agentIdOrNullWhenUnseeded(planned.slug);
  if (!agentId)
    return {
      ...base,
      state: {
        kind: 'unknown',
        reason: 'This tier has no seeded agent id yet. Run pnpm seed:agents.',
      },
    };
  try {
    const live = await client.beta.agents.retrieve(agentId);
    const fields = [
      ...diffAgent(planned, live).map(({ field }) => `${planned.slug}.${field}`),
      ...environmentFields,
    ];
    return { ...base, state: fields.length ? { kind: 'drifted', fields } : { kind: 'in-sync' } };
  } catch (error) {
    captureException(error, { feature: 'agents', op: 'prompt-drift', tier: planned.slug });
    return {
      ...base,
      state: {
        kind: 'unknown',
        reason: 'Could not reach Anthropic to compare agent configuration.',
      },
    };
  }
}

export const getTierConfigDrift = cache(async (): Promise<TierConfigDrift[]> => {
  if (!env.ANTHROPIC_ENVIRONMENT_ID)
    return unknownTiers('No ANTHROPIC_ENVIRONMENT_ID is configured. Run pnpm seed:agents.');
  const client = getAnthropicClient();
  if (!client) return unknownTiers('No Anthropic API key is configured.');
  const plan = buildSeedPlanFromCapabilities(capabilities, 'comparison');
  let environment: LiveEnvironmentConfig;
  try {
    const live = await client.beta.environments.retrieve(env.ANTHROPIC_ENVIRONMENT_ID);
    if (live.config.type !== 'cloud')
      return unknownTiers('The configured environment is not a cloud environment.');
    environment = live.config;
  } catch (error) {
    captureException(error, { feature: 'agents', op: 'environment-drift' });
    return unknownTiers('Could not reach Anthropic to compare environment configuration.');
  }
  const fields = diffEnvironment(plan.environment.config, environment).map(
    ({ field }) => `environment.${field}`,
  );
  return Promise.all(plan.agents.map((agent) => driftForTier(agent, client, fields)));
});
