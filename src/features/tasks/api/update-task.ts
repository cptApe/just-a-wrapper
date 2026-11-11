// Changing trigger kind or event target requires a new task because it replaces external state.
// Edits keep the creator identity; event runs read their current instructions from the row.

import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { task as taskTable } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { extend } from '@/lib/request-context';
import { resolveTaskSchedule } from '../lib/resolve-task-schedule';
import type { EditableTask, UpdateTaskInput } from '../types';
import { assertCanCreateScheduledTask } from './assert-schedule-limit';
import { syncOrLeaveForSweep, syncTaskProvider } from './sync-task-provider';
import { rejectedScheduleError } from './task-deployments';
import { loadWritableTask } from './task-lifecycle';
import { type TaskRow, writeTaskDefinition } from './task-transitions';
import { taskVisibleToViewer } from './task-visibility';

function changed(taskId: string, expectedVersion: number): AppError {
  return new AppError('CONFLICT', 'This schedule changed. Reload to see the latest version.', {
    taskId,
    expectedVersion,
  });
}

/** The row is written first and is the truth; the provider is then made to match it. */
export async function updateTask(input: UpdateTaskInput): Promise<{ version: number }> {
  input = { ...input, title: input.title.trim(), description: input.description.trim() };
  if (!input.title) throw new AppError('TOOL_INPUT_INVALID', 'Task name is required', {});
  if (!input.description) throw new AppError('TOOL_INPUT_INVALID', 'Task prompt is required', {});

  const row = await loadWritableTask(input);
  if (row.runAt && (row.status === 'running' || row.status === 'done' || row.status === 'removed'))
    throw new AppError(
      'TOOL_INPUT_INVALID',
      'This schedule already ran. Create a new one instead.',
      {
        taskId: row.id,
      },
    );
  if (row.status !== 'upcoming' && row.status !== 'paused')
    throw new AppError('CONFLICT', 'This task cannot be edited in its current state', {
      taskId: row.id,
      status: row.status,
    });
  if (row.version !== input.expectedVersion) throw changed(row.id, input.expectedVersion);
  extend({ task_id: row.id });
  const shared = {
    title: input.title,
    icon: input.icon,
    description: input.description,
    tier: input.tier ?? row.tier,
    autoApprove: input.autoApprove ?? row.autoApprove,
    notification: input.notification ?? row.notification,
    attachments: input.attachments ?? null,
  };

  if (row.triggerType === 'event') {
    // Row-only: the webhook builds each run straight from these columns.
    const version = await writeTaskDefinition(db, {
      taskId: row.id,
      expectedVersion: input.expectedVersion,
      definition: shared,
      status: row.status,
      sync: null,
    });
    if (version === null) throw changed(row.id, input.expectedVersion);
    return { version };
  }
  // A schedule still being created has no deployment to update yet.
  if (!row.anthropicDeploymentId)
    throw new AppError('TOOL_INPUT_INVALID', 'This task type is not editable', {
      taskId: row.id,
      triggerType: row.triggerType,
    });

  // A full plan is refused before the schedule is checked; the write checks again under the lock.
  if (input.paused === false && row.status === 'paused')
    await db.transaction((tx) => assertCanCreateScheduledTask(row.workspaceId, input.userId, tx));
  const schedule = resolveTaskSchedule(input, row);
  const status =
    input.paused === true ? 'paused' : input.paused === false ? 'upcoming' : row.status;
  if (status === 'upcoming' && schedule.runAt && schedule.runAt.getTime() <= Date.now())
    throw new AppError('TOOL_INPUT_INVALID', 'Choose a future time before resuming this one-off', {
      taskId: row.id,
    });
  const definition = {
    ...shared,
    successCriteria:
      input.successCriteria === undefined
        ? row.successCriteria
        : input.successCriteria?.trim() || null,
    cronSchedule: input.cron?.trim() ?? null,
    runAt: schedule.runAt,
    timezone: schedule.timezone,
    nextRunAt: status === 'paused' ? null : (schedule.runAt ?? row.nextRunAt),
  };
  const version = await db.transaction(async (tx) => {
    // Resuming takes a schedule slot under the plan lock, in the same write.
    if (status === 'upcoming' && row.status === 'paused')
      await assertCanCreateScheduledTask(row.workspaceId, input.userId, tx);
    return writeTaskDefinition(tx, {
      taskId: row.id,
      expectedVersion: input.expectedVersion,
      definition,
      status,
      sync: 'definition',
    });
  });
  if (version === null) throw changed(row.id, input.expectedVersion);
  await pushEdit(row, version, { cron: input.cron, timezone: schedule.timezone });
  return { version };
}

async function pushEdit(row: TaskRow, version: number, context: Record<string, unknown>) {
  let result: Awaited<ReturnType<typeof syncTaskProvider>>;
  try {
    result = await syncTaskProvider(row.id);
  } catch (error) {
    const rejected = rejectedScheduleError(error, context);
    if (!rejected) {
      // The edit is saved; an unreachable provider is finished by the sync sweep.
      await syncOrLeaveForSweep(row.id);
      return;
    }
    // The provider refused this definition and still holds the previous one: put it back.
    await writeTaskDefinition(db, {
      taskId: row.id,
      expectedVersion: version,
      definition: previousDefinition(row),
      status: row.status === 'paused' ? 'paused' : 'upcoming',
      sync: null,
    });
    await syncOrLeaveForSweep(row.id);
    throw rejected;
  }
  if (result === 'one_off_mismatch')
    throw new AppError('TOOL_INPUT_INVALID', 'Provider schedule does not match this one-off time', {
      taskId: row.id,
    });
}

function previousDefinition(row: TaskRow) {
  return {
    title: row.title,
    icon: row.icon,
    description: row.description,
    successCriteria: row.successCriteria,
    tier: row.tier,
    autoApprove: row.autoApprove,
    notification: row.notification,
    attachments: row.attachments,
    cronSchedule: row.cronSchedule,
    runAt: row.runAt,
    timezone: row.timezone,
    nextRunAt: row.nextRunAt,
  };
}

export async function getTaskForEdit(input: {
  userId: string;
  taskId: string;
  workspaceId: string;
}): Promise<EditableTask> {
  const row = (
    await db
      .select()
      .from(taskTable)
      .where(
        and(
          eq(taskTable.id, input.taskId),
          eq(taskTable.workspaceId, input.workspaceId),
          taskVisibleToViewer(input.userId),
        ),
      )
      .limit(1)
  ).at(0);
  if (!row) throw new AppError('TASK_NOT_FOUND', 'Task not found', input);
  extend({ task_id: row.id });
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    title: row.title,
    icon: row.icon,
    description: row.description ?? '',
    successCriteria: row.successCriteria ?? '',
    triggerType: row.triggerType,
    tier: row.tier,
    autoApprove: row.autoApprove,
    notification: row.notification,
    attachments: row.attachments ?? null,
    cron: row.cronSchedule,
    runAt: row.runAt,
    timezone: row.timezone,
    toolkit: row.eventToolkit,
    eventType: row.eventType,
  };
}
