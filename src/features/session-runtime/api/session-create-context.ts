import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { AgentTier } from '@/features/agents';
import { requireAgentId, requireEnvironmentId } from '@/features/agents';
import { ensureMemberVault } from '@/features/integrations/api/provision-vault';
import { type MemoryStoreResource, resolveSessionMemoryResources } from '@/features/memory';
import { syncAgentSkillsForDeployment } from '@/features/sessions/api/sync-agent-skills-for-deployment';
import { listSessionSkillRefs } from '@/features/skills/server';
import {
  buildSessionAgentWithOverrides,
  buildSkillSessionResources,
} from '../lib/session-resources';

// Resolve the pinned agent, skills, environment, memory and member vault once
// for chat and scheduled runs. Deployments inherit this context into their sessions.

export type SessionCreateContext = {
  /** Session-local skill override, or a deployment-compatible pinned reference. */
  agent:
    | string
    | Anthropic.Beta.Sessions.BetaManagedAgentsAgentParams
    | Anthropic.Beta.Sessions.BetaManagedAgentsAgentWithOverridesParams;
  environmentId: string;
  /** Creator's user + workspace memory stores (possibly empty). */
  resources: MemoryStoreResource[];
  /** The member's MCP-proxy vault (empty when unprovisionable). */
  vaultIds: string[];
};

type DeploymentCreateContext = Omit<SessionCreateContext, 'agent'> & {
  agent: string | Anthropic.Beta.Sessions.BetaManagedAgentsAgentParams;
};

type ResolveContextInput = {
  tier: AgentTier;
  workspaceId: string;
  createdByUserId: string;
  organizationId: string;
};

export function resolveSessionCreateContext(
  client: Anthropic,
  input: ResolveContextInput & { target: 'deployment' },
): Promise<DeploymentCreateContext>;
export function resolveSessionCreateContext(
  client: Anthropic,
  input: ResolveContextInput & { target: 'session' },
): Promise<SessionCreateContext>;

export async function resolveSessionCreateContext(
  client: Anthropic,
  input: ResolveContextInput & { target: 'session' | 'deployment' },
): Promise<SessionCreateContext> {
  const agentId = requireAgentId(input.tier);
  const environmentId = requireEnvironmentId();

  const resources = await resolveSessionMemoryResources({
    organizationId: input.organizationId,
    userId: input.createdByUserId,
  });
  const vaultId = await ensureMemberVault({
    refreshCredential: false,
    organizationId: input.organizationId,
    userId: input.createdByUserId,
  });
  const vaultIds = vaultId ? [vaultId] : [];

  // Sessions use complete skill overrides so concurrent starts cannot mutate a shared agent.
  // Deployments require a version-pinned reference because their API lacks that override.
  const skillParams = buildSkillSessionResources(
    await listSessionSkillRefs({ workspaceId: input.workspaceId }),
  );
  const agent =
    input.target === 'deployment'
      ? await syncAgentSkillsForDeployment(client, { agentId, skills: skillParams })
      : buildSessionAgentWithOverrides(agentId, skillParams);

  return { agent, environmentId, resources, vaultIds };
}
