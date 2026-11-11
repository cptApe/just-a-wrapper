import { APIError } from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { task } from '@/db/schema';
import { getAnthropicClient } from '@/features/agents';
import { deleteTriggerInstance } from '@/features/tasks/api/composio-triggers';
import { AppError } from '@/lib/errors';
import { capabilities } from '@/lib/runtime-capabilities';
import { assertBeforeDeadline } from '@/lib/sweep-deadline';

export async function stopWorkspaceTasks(workspaceId: string, deadline: number): Promise<void> {
  const schedules = await db
    .select({
      id: task.id,
      deploymentId: task.anthropicDeploymentId,
      triggerId: task.composioTriggerId,
    })
    .from(task)
    .where(eq(task.workspaceId, workspaceId));
  for (const schedule of schedules) {
    assertBeforeDeadline(deadline);
    if (schedule.deploymentId !== null) {
      const client = getAnthropicClient();
      // Disabled credentials do not stop remote schedules; retain their IDs for cleanup.
      if (client === null)
        throw new AppError(
          'INTEGRATION_NOT_CONNECTED',
          'Retain workspace task resources until Anthropic is configured for cleanup',
          {
            workspaceId,
            deploymentId: schedule.deploymentId,
            cleanupDecision: 'retain-for-provider',
          },
        );
      try {
        await client.beta.deployments.archive(schedule.deploymentId, undefined, {
          timeout: 10_000,
          maxRetries: 0,
        });
      } catch (cause) {
        if (!(cause instanceof APIError && cause.status === 404))
          throw new AppError(
            'EXTERNAL_API_FAILED',
            'Workspace deployment archival failed',
            { workspaceId, deploymentId: schedule.deploymentId },
            { cause },
          );
      }
    }
    if (schedule.deploymentId !== null)
      await db
        .update(task)
        .set({ anthropicDeploymentId: null })
        .where(
          and(eq(task.id, schedule.id), eq(task.anthropicDeploymentId, schedule.deploymentId)),
        );
    assertBeforeDeadline(deadline);
    if (schedule.triggerId !== null) {
      const { connectedApps } = capabilities;
      if (connectedApps.kind === 'off')
        throw new AppError(
          'INTEGRATION_NOT_CONNECTED',
          'Retain workspace task resources until Composio is configured for cleanup',
          { workspaceId, triggerId: schedule.triggerId, cleanupDecision: 'retain-for-provider' },
        );
      await deleteTriggerInstance(connectedApps.apiKey, schedule.triggerId);
      await db
        .update(task)
        .set({ composioTriggerId: null })
        .where(and(eq(task.id, schedule.id), eq(task.composioTriggerId, schedule.triggerId)));
    }
  }
}
