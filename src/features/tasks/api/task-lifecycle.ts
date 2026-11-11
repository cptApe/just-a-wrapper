import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { task as taskTable, workspace } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { assertCanSpend } from '@/features/billing/api/spend-gate';
import { notificationChannels } from '@/features/notifications/lib/task-notification';
import { notify } from '@/features/notifications/server';
import { AppError, IntegrationError } from '@/lib/errors';
import { extend } from '@/lib/request-context';
import { taskMachine } from '../lib/task-machine';
import { adoptTaskRunSession } from './adopt-task-run';
import { assertCanCreateScheduledTask } from './assert-schedule-limit';
import { syncOrLeaveForSweep } from './sync-task-provider';
import {
  firstUpcomingRun,
  isDefiniteRefusal,
  retrieveDeployment,
  startDeploymentRun,
} from './task-deployments';
import { claimTaskEvent } from './task-event-transitions';
import { claimRunNow, moveTask, releaseRunNow, type TaskRow } from './task-transitions';
import { taskWritableBy } from './task-visibility';

type TaskCommand = { taskId: string; workspaceId: string; userId: string };

/** Decision 0020: only the creator changes, runs or deletes a task. */
export async function loadWritableTask(input: TaskCommand): Promise<TaskRow> {
  const row = (
    await db
      .select()
      .from(taskTable)
      .where(
        and(
          eq(taskTable.id, input.taskId),
          eq(taskTable.workspaceId, input.workspaceId),
          taskWritableBy(input.userId),
        ),
      )
      .limit(1)
  ).at(0);
  if (!row)
    throw new AppError('TASK_NOT_FOUND', 'Task not found', {
      taskId: input.taskId,
      workspaceId: input.workspaceId,
    });
  extend({ task_id: row.id });
  return row;
}

function oneOffMismatch(taskId: string): AppError {
  return new AppError('TOOL_INPUT_INVALID', 'Provider schedule does not match this one-off time', {
    taskId,
  });
}

export async function pauseTask(input: TaskCommand): Promise<void> {
  const task = await loadWritableTask(input);
  if (task.status !== 'paused') {
    taskMachine.assertCan(task.status, 'paused');
    const moved = await moveTask(db, {
      taskId: task.id,
      to: 'paused',
      sync: 'status',
      nextRunAt: null,
    });
    if (moved === null) throw new AppError('CONFLICT', 'Task changed during this command', input);
  }
  await syncOrLeaveForSweep(task.id);
}

export async function resumeTask(input: TaskCommand): Promise<void> {
  const task = await loadWritableTask(input);
  if (task.status !== 'upcoming') {
    if (task.runAt && task.runAt.getTime() <= Date.now())
      throw new AppError(
        'TOOL_INPUT_INVALID',
        'Choose a future time before resuming this one-off',
        {
          taskId: task.id,
        },
      );
    taskMachine.assertCan(task.status, 'upcoming');
    const moved = await db.transaction(async (tx) => {
      await assertCanCreateScheduledTask(task.workspaceId, input.userId, tx);
      return moveTask(tx, { taskId: task.id, to: 'upcoming', sync: 'status' });
    });
    if (moved === null) throw new AppError('CONFLICT', 'Task changed during this command', input);
  }
  if ((await syncOrLeaveForSweep(task.id)) === 'one_off_mismatch') throw oneOffMismatch(task.id);
}

export async function deleteTask(input: TaskCommand): Promise<void> {
  const task = await loadWritableTask(input);
  if (task.status === 'removed') return;
  const moved = await moveTask(db, {
    taskId: task.id,
    to: 'removed',
    sync: 'status',
    nextRunAt: null,
  });
  if (moved === null) throw new AppError('CONFLICT', 'Task changed during this command', input);
  await syncOrLeaveForSweep(task.id);
}

/** A deployment state webhook. Only a change the app did not ask for is mirrored and alerted. */
export async function mirrorDeploymentState(input: {
  anthropicDeploymentId: string;
  webhookEventId: string;
}) {
  const owner = (
    await db
      .select({ task: taskTable, organizationId: workspace.organizationId })
      .from(taskTable)
      .innerJoin(workspace, eq(taskTable.workspaceId, workspace.id))
      .where(eq(taskTable.anthropicDeploymentId, input.anthropicDeploymentId))
      .limit(1)
  ).at(0);
  if (!owner) return { handled: false, taskId: null };
  const row = owner.task;
  // A push still owed to the provider decides the final state; its own echo is not news.
  if (row.providerSync !== 'synced' || (row.status !== 'upcoming' && row.status !== 'paused'))
    return { handled: false, taskId: row.id };
  const deployment = await retrieveDeployment(input.anthropicDeploymentId);
  if (deployment.archived_at !== null) return { handled: false, taskId: row.id };
  const target = deployment.status === 'paused' ? 'paused' : 'upcoming';
  if (row.status === target) return { handled: false, taskId: row.id };
  const moved = await db.transaction(async (tx) => {
    if (
      !(await claimTaskEvent(tx, {
        eventId: input.webhookEventId,
        eventType: 'deployment.state',
        payload: input,
      }))
    )
      return false;
    const version = await moveTask(tx, {
      taskId: row.id,
      to: target,
      sync: null,
      expectedVersion: row.version,
      nextRunAt: target === 'paused' ? null : (row.runAt ?? firstUpcomingRun(deployment)),
    });
    if (version === null)
      throw new AppError('CONFLICT', 'Task changed while mirroring deployment', { taskId: row.id });
    return true;
  });
  if (moved && target === 'paused') {
    const channels = notificationChannels(row.notification);
    if (channels.email || channels.inApp)
      await notify('task.failed', {
        organizationId: owner.organizationId,
        recipientUserIds: [row.createdByUserId],
        channels: { inApp: channels.inApp, email: channels.email ? 'force' : 'off' },
        idempotencyKey: `deployment-paused:${input.webhookEventId}`,
        data: {
          title: 'Scheduled task paused',
          body: 'The schedule was paused because one of its dependencies needs attention.',
        },
      });
  }
  return { handled: moved, taskId: row.id };
}

export async function runTaskNow(
  input: TaskCommand,
): Promise<{ anthropicSessionId: string | null }> {
  const task = await loadWritableTask(input);
  if (
    task.triggerType !== 'schedule' ||
    task.runAt !== null ||
    (task.status !== 'upcoming' && task.status !== 'paused') ||
    !task.anthropicDeploymentId
  ) {
    throw new AppError('TOOL_INPUT_INVALID', 'Only active recurring schedules support run-now', {
      taskId: task.id,
    });
  }
  await assertCanSpend({ entry: 'run_now', workspaceId: input.workspaceId, userId: input.userId });
  const claimedAt = await claimRunNow(task.id);
  if (!claimedAt) throw new AppError('CONFLICT', 'A run-now request is already in progress', input);
  const run = await startDeploymentRun(task.anthropicDeploymentId).catch(async (error: unknown) => {
    // A definite refusal starts no run. A timeout or conflict may have, so the sweep decides.
    if (isDefiniteRefusal(error, { rateLimitIsDefinite: true }))
      await releaseRunNow(task.id, claimedAt);
    throw error;
  });
  if (!run.session_id) {
    await releaseRunNow(task.id, claimedAt);
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Deployment run failed to create a session', {
      taskId: task.id,
      runId: run.id,
      error: run.error,
    });
  }
  await adoptTaskRunSession(await requireAnthropicClient().beta.sessions.retrieve(run.session_id));
  // The run exists and is adopted, so the next run-now may start at once.
  await releaseRunNow(task.id, claimedAt);
  return { anthropicSessionId: run.session_id };
}
