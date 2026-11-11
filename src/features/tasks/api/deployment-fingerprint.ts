import 'server-only';
import { createHash } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { requireAgentId } from '@/features/agents';
import { buildSkillSessionResources } from '@/features/session-runtime/lib/session-resources';
import { resolveSessionStartGrounding } from '@/features/sessions';
import { listSessionSkillRefs } from '@/features/skills/api/list-skills';
import type { TaskRow } from './task-transitions';

type FingerprintRow = Pick<
  TaskRow,
  | 'tier'
  | 'workspaceId'
  | 'createdByUserId'
  | 'title'
  | 'description'
  | 'attachments'
  | 'successCriteria'
>;

/**
 * Hash of everything a deployment snapshots: the agent, workspace skills, the task's own
 * instructions and what the run is told about its creator. A different hash means a push is due.
 */
export async function deploymentFingerprint(
  client: Anthropic,
  row: FingerprintRow,
): Promise<string> {
  const [agent, skillRefs, grounding] = await Promise.all([
    client.beta.agents.retrieve(requireAgentId(row.tier), {}, { timeout: 30_000 }),
    listSessionSkillRefs({ workspaceId: row.workspaceId }),
    resolveSessionStartGrounding({ userId: row.createdByUserId, workspaceId: row.workspaceId }),
  ]);
  const fingerprint = JSON.stringify(
    {
      agentId: agent.id,
      model: agent.model,
      system: agent.system,
      tools: agent.tools,
      servers: agent.mcp_servers,
      multiagent: agent.multiagent,
      skills: buildSkillSessionResources(skillRefs),
      grounding,
      tier: row.tier,
      title: row.title,
      description: row.description,
      attachments: row.attachments,
      successCriteria: row.successCriteria,
    },
    (_key, value: unknown) => {
      // Provider self references pin their own version; skill-only updates must not dirty every tenant.
      if (
        value &&
        typeof value === 'object' &&
        'id' in value &&
        value.id === agent.id &&
        'version' in value
      )
        return { type: 'self' };
      return value;
    },
  );
  return createHash('sha256').update(fingerprint).digest('hex');
}
