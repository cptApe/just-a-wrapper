import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspaceMember } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { captureEvent } from '@/lib/analytics';
import { AppError } from '@/lib/errors';
import { extend } from '@/lib/request-context';
import { composioCapability } from '@/lib/runtime-capabilities';
import { EVENT_TRIGGER_CATALOG } from '../constants';
import { resolveProviderSchedule } from '../lib/resolve-provider-schedule';
import type {
  CreatedTask,
  CreateEventTaskInput,
  CreateScheduleTaskInput,
  CreateTaskInput,
} from '../types';
import { assertCanCreateScheduledTask } from './assert-schedule-limit';
import { buildTaskDeployment } from './build-task-deployment';
import { requireActiveConnectedAccount, upsertTriggerInstance } from './composio-triggers';
import { insertEventTask } from './insert-event-task';
import { syncOrLeaveForSweep } from './sync-task-provider';
import {
  archiveDeployment,
  createTaskDeployment,
  firstUpcomingRun,
  isDefiniteRefusal,
  rejectedScheduleError,
} from './task-deployments';
import {
  activateCreatedTask,
  insertScheduledTask,
  rejectCreatedTaskSchedule,
  removeUnavailableTask,
} from './task-transitions';

// Cron tasks use Anthropic deployments with pinned agent, skills, vault and memory.
// metadata.task_id identifies sessions created by the deployment. Anthropic owns the tick.
// Event tasks use Composio triggers and the app webhook path.

export async function createTask(input: CreateTaskInput): Promise<CreatedTask> {
  input = { ...input, title: input.title.trim(), description: input.description.trim() };
  if (!input.title) {
    throw new AppError('TOOL_INPUT_INVALID', 'Task name is required', {});
  }
  if (!input.description) {
    throw new AppError('TOOL_INPUT_INVALID', 'Task prompt is required', {});
  }
  if (input.triggerType !== 'schedule') return createEventTask(input);
  return createScheduleTask(input);
}

async function createScheduleTask(input: CreateScheduleTaskInput): Promise<CreatedTask> {
  const client = requireAnthropicClient();
  const { runAt, providerCron } = resolveProviderSchedule({
    now: new Date(),
    cron: input.cron,
    runAt: input.runAt,
    timezone: input.timezone,
    validateInstant: true,
  });
  const parameters = await buildTaskDeployment(client, {
    ...input,
    successCriteria: input.successCriteria?.trim() || null,
  });
  // The row ID must exist before creating deployment metadata; network work runs after commit,
  // so deployment creation never holds a pooled connection or the plan lock.
  const row = await db.transaction(async (tx) => {
    await assertCanCreateScheduledTask(input.workspaceId, input.createdByUserId, tx);
    return insertScheduledTask(tx, input, runAt);
  });
  extend({ task_id: row.id });

  try {
    const deployment = await createTaskDeployment(
      parameters,
      { expression: providerCron, timezone: input.timezone },
      { task_id: row.id, workspace_id: input.workspaceId },
    );
    const nextRunAt = firstUpcomingRun(deployment);
    if (runAt && nextRunAt?.getTime() !== runAt.getTime()) {
      if (await rejectCreatedTaskSchedule(row.id, deployment.id)) await syncOrLeaveForSweep(row.id);
      else await archiveDeployment(deployment.id);
      throw new AppError(
        'TOOL_INPUT_INVALID',
        'The one-off time passed before scheduling completed. Choose a future time.',
        { taskId: row.id },
      );
    }
    const activated = await activateCreatedTask({
      taskId: row.id,
      deploymentId: deployment.id,
      nextRunAt: runAt ?? nextRunAt,
    });
    if (!activated) {
      await archiveDeployment(deployment.id);
      throw new AppError('CONFLICT', 'Task creation was cancelled', { taskId: row.id });
    }

    // The deployment id is on the row: the schedule is durable now.
    captureEvent(
      'task:schedule',
      {
        task_id: row.id,
        trigger_type: 'schedule',
        tier: input.tier,
        is_auto_approve: input.autoApprove,
        timezone: input.timezone,
        schedule_kind: runAt ? 'one_off' : 'recurring',
      },
      { userId: input.createdByUserId, workspaceId: input.workspaceId },
    );

    return { taskId: row.id };
  } catch (error) {
    // A definite rejection releases capacity; uncertain success keeps the correlation ID for recovery.
    if (isDefiniteRefusal(error)) await removeUnavailableTask(row.id);
    throw (
      rejectedScheduleError(error, {
        cron: input.cron,
        runAt: input.runAt?.toISOString(),
        timezone: input.timezone,
      }) ?? error
    );
  }
}

async function createEventTask(input: CreateEventTaskInput): Promise<CreatedTask> {
  // Refuse a full plan before touching Composio; the insert checks again under the lock.
  await db.transaction((tx) =>
    assertCanCreateScheduledTask(input.workspaceId, input.createdByUserId, tx),
  );
  const triggerId = await subscribeTaskEvent(input);
  const row = await insertEventTask(input, triggerId);
  extend({ task_id: row.id });
  captureEvent(
    'task:schedule',
    {
      task_id: row.id,
      trigger_type: 'event',
      tier: input.tier,
      is_auto_approve: input.autoApprove,
      event_toolkit: input.toolkit,
      event_type: input.eventType,
    },
    { userId: input.createdByUserId, workspaceId: input.workspaceId },
  );
  return { taskId: row.id };
}

async function subscribeTaskEvent(input: CreateEventTaskInput) {
  // Only proven triggers from the catalog — never arbitrary slugs through our
  // API.
  const supported = EVENT_TRIGGER_CATALOG.some(
    (t) => t.toolkit === input.toolkit && t.eventType === input.eventType,
  );
  if (!supported) {
    throw new AppError('TOOL_INPUT_INVALID', 'Unsupported event trigger', {
      toolkit: input.toolkit,
      eventType: input.eventType,
    });
  }
  const { apiKey } = composioCapability();

  // The trigger fires on the CREATOR's connected account; their composio_user_id
  // is the identity the trigger instance (and later the webhook's user_id) is
  // scoped to.
  const member = (
    await db
      .select({ composioUserId: workspaceMember.composioUserId })
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.organizationId, input.organizationId),
          eq(workspaceMember.userId, input.createdByUserId),
        ),
      )
      .limit(1)
  ).at(0);
  if (!member) {
    throw new AppError('WORKSPACE_NOT_FOUND', 'No workspace membership for task creator', {
      organizationId: input.organizationId,
    });
  }

  const { connectedAccountId } = await requireActiveConnectedAccount(
    member.composioUserId,
    apiKey,
    input.toolkit,
  );
  const { triggerId } = await upsertTriggerInstance(apiKey, {
    slug: input.eventType,
    connectedAccountId,
  });

  return triggerId;
}
