import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { BetaManagedAgentsSkillParams } from '@anthropic-ai/sdk/resources/beta/agents';
import { AppError, IntegrationError } from '@/lib/errors';
// Deployments in SDK 0.116.0 accept only a plain/versioned agent reference, not
// `agent_with_overrides`. Keep the shared-agent mutation isolated to that API
// until deployments gain the same per-run override supported by sessions.
export async function syncAgentSkillsForDeployment(
  client: Anthropic,
  input: { agentId: string; skills: BetaManagedAgentsSkillParams[] },
): Promise<Anthropic.Beta.Sessions.BetaManagedAgentsAgentParams> {
  try {
    const current = await client.beta.agents.retrieve(input.agentId);
    const updated = await client.beta.agents.update(input.agentId, {
      version: current.version,
      skills: input.skills,
    });
    return { type: 'agent', id: input.agentId, version: updated.version };
  } catch (cause) {
    if (cause instanceof AppError) {
      throw cause;
    }
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Failed to attach workspace skills for a scheduled deployment',
      { agentId: input.agentId, skillCount: input.skills.length },
      { cause },
    );
  }
}
