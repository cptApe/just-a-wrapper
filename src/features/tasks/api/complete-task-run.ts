// Notification recipients use the Better Auth organization ID from the workspace,
// never the unrelated Anthropic organization ID in the webhook envelope.

import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  processedWebhookEvent,
  session as sessionTable,
  task as taskTable,
  workspace,
} from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { AUTO_RESUME_CUTOFF_MS } from '@/features/billing/api/sync-session-budgets';
import { notificationChannels } from '@/features/notifications/lib/task-notification';
import { notify } from '@/features/notifications/server';
import { finishExpiredTaskPause } from '@/features/sessions/api/session-transitions';
import { shipLog } from '@/lib/logger';
import { adoptTaskRunBySessionId, refreshTaskRunTimes } from './adopt-task-run';
import { syncTaskProvider } from './sync-task-provider';
import { claimTaskEvent } from './task-event-transitions';
import { taskRunHasCompleted } from './task-run-completion';
import { moveTask } from './task-transitions';

type RunCompletion = { handled: boolean; taskId: string | null; organizationId: string | null };

/**
 * Mark the run finished. `outcome: 'idle'` = healthy completion (status_idled),
 * `'terminated'` = the unrecoverable-error path. Unknown sessions are adopted
 * first (a deployment fire whose status_run_started webhook we missed or that
 * isn't registered — the status_idled is then our first sighting of the run).
 */
export async function completeTaskRun(input: {
  anthropicSessionId: string;
  outcome: 'idle' | 'terminated';
  webhookEventId: string;
}): Promise<RunCompletion> {
  const claimed = await db
    .select({ eventId: processedWebhookEvent.eventId })
    .from(processedWebhookEvent)
    .where(
      and(
        eq(processedWebhookEvent.provider, 'anthropic'),
        eq(processedWebhookEvent.eventId, input.webhookEventId),
      ),
    )
    .limit(1);
  if (claimed.length > 0) return { handled: false, taskId: null, organizationId: null };
  let row = (await loadRow(input.anthropicSessionId)).at(0);

  if (!row) {
    // First sighting — adopt if it maps to a task (no-op for foreign sessions).
    const adopted = await adoptTaskRunBySessionId(input.anthropicSessionId);
    if (!adopted?.adopted) {
      return { handled: false, taskId: null, organizationId: null };
    }
    row = (await loadRow(input.anthropicSessionId)).at(0);
    if (!row) {
      return { handled: false, taskId: null, organizationId: null };
    }
  }
  if (row.kind !== 'task_run' || !row.taskId) {
    return { handled: false, taskId: null, organizationId: null };
  }

  // Credit-paused runs remain open through the same window used by automatic top-up resume.
  const creditPauseExpired =
    row.status === 'paused_no_credits' &&
    row.pausedAt !== null &&
    row.pausedAt.getTime() < Date.now() - AUTO_RESUME_CUTOFF_MS;
  if (
    row.status === 'pausing' ||
    row.status === 'resuming' ||
    (row.status === 'paused_no_credits' && !creditPauseExpired)
  ) {
    return { handled: false, taskId: row.taskId, organizationId: row.organizationId };
  }
  if (
    !creditPauseExpired &&
    input.outcome === 'idle' &&
    !(await taskRunHasCompleted(input.anthropicSessionId))
  ) {
    return { handled: false, taskId: row.taskId, organizationId: row.organizationId };
  }
  const completedRow = row;
  const completed = await db.transaction(async (tx) => {
    if (
      creditPauseExpired &&
      completedRow.endedAt === null &&
      !(await finishExpiredTaskPause(tx, {
        sessionId: completedRow.id,
        version: completedRow.stateVersion,
        cutoff: new Date(Date.now() - AUTO_RESUME_CUTOFF_MS),
      }))
    )
      return false;
    if (
      !(await claimTaskEvent(tx, {
        eventId: input.webhookEventId,
        eventType: 'task.completed',
        payload: input,
      }))
    )
      return false;
    if (completedRow.taskRunAt && completedRow.taskId) {
      await moveTask(tx, {
        taskId: completedRow.taskId,
        to: 'done',
        sync: 'status',
        nextRunAt: null,
      });
    }
    return true;
  });
  if (!completed) return { handled: false, taskId: row.taskId, organizationId: row.organizationId };

  shipLog({
    level: input.outcome === 'terminated' ? 'error' : 'info',
    msg: input.outcome === 'terminated' ? 'task_run.failed' : 'task_run.completed',
    feature: 'tasks',
    op: 'complete-run',
    task_id: row.taskId,
    session_id: input.anthropicSessionId,
    webhook_event_id: input.webhookEventId,
  });

  if (row.taskDeploymentId) {
    if (row.taskRunAt) await syncTaskProvider(row.taskId);
    else await refreshTaskRunTimes(row.taskId, row.taskDeploymentId);
  }
  return { handled: true, taskId: row.taskId, organizationId: row.organizationId };
}

type DeploymentFailureOutcome = { handled: boolean; taskId: string | null };

/** Record a deployment execution that failed before a session was created. */
export async function completeDeploymentRunFailure(input: {
  anthropicDeploymentRunId: string;
  webhookEventId: string;
  occurredAt: string;
}): Promise<DeploymentFailureOutcome> {
  const client = requireAnthropicClient();
  const run = await client.beta.deploymentRuns.retrieve(input.anthropicDeploymentRunId);
  const task = (
    await db
      .select({
        id: taskTable.id,
        createdByUserId: taskTable.createdByUserId,
        organizationId: workspace.organizationId,
        notification: taskTable.notification,
        runAt: taskTable.runAt,
      })
      .from(taskTable)
      .innerJoin(workspace, eq(taskTable.workspaceId, workspace.id))
      .where(eq(taskTable.anthropicDeploymentId, run.deployment_id))
      .limit(1)
  ).at(0);
  if (!task) {
    shipLog({
      level: 'warn',
      msg: 'task_run.failure.unknown_deployment',
      feature: 'tasks',
      op: 'complete-deployment-run-failure',
      deployment_run_id: run.id,
      deployment_id: run.deployment_id,
    });
    return { handled: false, taskId: null };
  }

  await db.transaction(async (tx) => {
    if (
      !(await claimTaskEvent(tx, {
        eventId: input.webhookEventId,
        eventType: 'deployment_run.failed',
        payload: input,
      }))
    )
      return;
    if (task.runAt)
      await moveTask(tx, {
        taskId: task.id,
        to: 'done',
        sync: 'status',
        nextRunAt: null,
        lastRunAt: new Date(input.occurredAt),
      });
  });
  if (task.runAt) await syncTaskProvider(task.id);
  else await refreshTaskRunTimes(task.id, run.deployment_id);
  shipLog({
    level: 'error',
    msg: 'task_run.failed',
    feature: 'tasks',
    op: 'complete-deployment-run-failure',
    task_id: task.id,
    deployment_run_id: run.id,
    deployment_id: run.deployment_id,
    run_error_type: run.error?.type,
    webhook_event_id: input.webhookEventId,
    occurred_at: input.occurredAt,
  });
  const channels = notificationChannels(task.notification);
  if (!channels.email && !channels.inApp) return { handled: true, taskId: task.id };
  await notify('task.failed', {
    organizationId: task.organizationId,
    recipientUserIds: [task.createdByUserId],
    channels: { inApp: channels.inApp, email: channels.email ? 'force' : 'off' },
    idempotencyKey: `deployment-run-failed:${run.id}`,
    data: {
      title: 'Scheduled task failed',
      body: run.error?.message ?? 'The scheduled task could not start.',
    },
  });
  return { handled: true, taskId: task.id };
}

function loadRow(anthropicSessionId: string) {
  return db
    .select({
      id: sessionTable.id,
      kind: sessionTable.kind,
      status: sessionTable.status,
      stateVersion: sessionTable.stateVersion,
      pausedAt: sessionTable.pausedAt,
      endedAt: sessionTable.endedAt,
      taskId: sessionTable.taskId,
      taskDeploymentId: taskTable.anthropicDeploymentId,
      taskRunAt: taskTable.runAt,
      // Better Auth org id (via the session's workspace) — the recipient key for
      // notifications, distinct from the webhook envelope's Anthropic org id.
      organizationId: workspace.organizationId,
    })
    .from(sessionTable)
    .innerJoin(workspace, eq(sessionTable.workspaceId, workspace.id))
    .leftJoin(taskTable, eq(sessionTable.taskId, taskTable.id))
    .where(eq(sessionTable.anthropicSessionId, anthropicSessionId))
    .limit(1);
}
