import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { tierSupportsSystemMessages } from '@/features/agents/config';
import { sessionBudgetForWorkspace } from '@/features/billing/api/session-budget';
import { resolveSessionCreateContext } from '@/features/session-runtime';
import { composeDeploymentSystemText, resolveSessionStartGrounding } from '@/features/sessions';
import { buildDeploymentInitialEvents } from '../lib/build-deployment-initial-events';
import { withAttachedFiles } from '../lib/task-attachments';
import type { UpdateTaskInput } from '../types';

export async function buildTaskDeployment(
  client: Anthropic,
  input: Required<
    Pick<UpdateTaskInput, 'tier' | 'workspaceId' | 'organizationId' | 'title' | 'description'>
  > &
    Pick<UpdateTaskInput, 'attachments'> & {
      createdByUserId: string;
      successCriteria: string | null;
    },
) {
  const [context, budget, grounding] = await Promise.all([
    resolveSessionCreateContext(client, {
      tier: input.tier,
      workspaceId: input.workspaceId,
      createdByUserId: input.createdByUserId,
      organizationId: input.organizationId,
      target: 'deployment',
    }),
    sessionBudgetForWorkspace(input.workspaceId),
    resolveSessionStartGrounding({
      userId: input.createdByUserId,
      workspaceId: input.workspaceId,
    }),
  ]);

  const systemText = composeDeploymentSystemText({
    timeZone: grounding.timeZone,
    displayName: grounding.displayName,
    workspaceName: grounding.workspaceName,
    replyLanguage: grounding.replyLanguage,
  });
  return {
    agent: context.agent,
    budget,
    environment_id: context.environmentId,
    name: input.title,
    description: input.description.slice(0, 500),
    initial_events: buildDeploymentInitialEvents({
      description: withAttachedFiles(input.description, input.attachments),
      systemText,
      systemTextMode: tierSupportsSystemMessages(input.tier) ? 'event' : 'inline',
      successCriteria: input.successCriteria,
    }),
    // Empty replacements clear provider state; omit unresolved vaults/resources to preserve access.
    ...(context.vaultIds.length > 0 ? { vault_ids: context.vaultIds } : {}),
    ...(context.resources.length > 0 ? { resources: context.resources } : {}),
  };
}
