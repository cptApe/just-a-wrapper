import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { env } from '@/lib/env';
import { CapabilityOffError } from '@/lib/errors';
import { lazyValue } from '@/lib/lazy-value';

// One SDK client per server process. Null without a key, so callers can show a missing-key state
// instead of failing at module load; passing the key explicitly makes its absence testable.

export const getAnthropicClient = lazyValue((): Anthropic | null => {
  const apiKey = env.ANTHROPIC_API_KEY;
  return apiKey ? new Anthropic({ apiKey }) : null;
});

// The seeded agent ID for a tier, written to env by the seed script. An unseeded tier throws
// CapabilityOffError, which routes show as their capability-off message.
export function requireAgentId(tier: 'fast' | 'default' | 'pro'): string {
  const id =
    tier === 'pro'
      ? env.ANTHROPIC_AGENT_ID_PRO
      : tier === 'fast'
        ? env.ANTHROPIC_AGENT_ID_FAST
        : env.ANTHROPIC_AGENT_ID_DEFAULT;
  if (!id) {
    throw new CapabilityOffError(CAPABILITY_OFF_MESSAGES.agentNotSeeded, { tier });
  }
  return id;
}

export function requireEnvironmentId(): string {
  const id = env.ANTHROPIC_ENVIRONMENT_ID;
  if (!id) {
    throw new CapabilityOffError(CAPABILITY_OFF_MESSAGES.agentNotSeeded);
  }
  return id;
}

export function requireAnthropicClient() {
  const client = getAnthropicClient();
  if (!client) throw new CapabilityOffError(CAPABILITY_OFF_MESSAGES.agent);
  return client;
}
