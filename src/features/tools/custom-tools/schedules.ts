import { z } from 'zod';
import { createTask } from '@/features/tasks/api/create-task';
import { listScheduledItems } from '@/features/tasks/api/list-scheduled-items';
import { deleteTask, pauseTask, resumeTask } from '@/features/tasks/api/task-lifecycle';
import { getTaskForEdit, updateTask } from '@/features/tasks/api/update-task';
import { scheduleLabel } from '@/features/tasks/lib/schedule-label';
import { scheduleState } from '@/features/tasks/lib/schedule-state';
import type { EditableTask, TaskScheduledItem } from '@/features/tasks/types';
import {
  CREATE_SCHEDULE_DECL,
  DELETE_SCHEDULE_DECL,
  LIST_SCHEDULES_DECL,
  UPDATE_SCHEDULE_DECL,
} from '@/features/tool-catalog/schedule-declarations';
import type { CustomTool } from '@/features/tool-catalog/types';
import { ToolError } from '@/lib/errors';
import { getScheduleAccess, resolveScheduleContext } from '../api/schedule-access';
import {
  CreateScheduleInputSchema,
  CreateScheduleOutputSchema,
  DeleteScheduleInputSchema,
  DeleteScheduleOutputSchema,
  ListSchedulesInputSchema,
  ListSchedulesOutputSchema,
  UpdateScheduleInputSchema,
  UpdateScheduleOutputSchema,
} from '../lib/schedule-schemas';

type ToolContext = Parameters<CustomTool['handler']>[1];
type CreateInput = z.infer<typeof CreateScheduleInputSchema>;
type UpdateInput = z.infer<typeof UpdateScheduleInputSchema>;

type ScheduleAccess = NonNullable<Awaited<ReturnType<typeof getScheduleAccess>>>;
const AGENT = { kind: 'agent' } as const;

function requireSchedule(task: EditableTask, input: { taskId: string }): EditableTask {
  if (task.triggerType !== 'schedule') {
    throw new ToolError('TOOL_INPUT_INVALID', 'The requested task is not a schedule', input);
  }
  return task;
}

async function requireScheduleAccess(
  taskId: string,
  ctx: ToolContext,
  mode: 'read' | 'write',
): Promise<ScheduleAccess> {
  const task = await getScheduleAccess({ taskId, workspaceId: ctx.workspaceId });
  const allowed =
    task &&
    (task.createdByUserId === ctx.userId || (mode === 'read' && task.visibility === 'workspace'));
  if (!task || task.triggerType !== 'schedule' || !allowed) {
    throw new ToolError('TASK_NOT_FOUND', 'Schedule not found', {
      taskId,
      workspaceId: ctx.workspaceId,
    });
  }
  return task;
}

function toSummary(task: TaskScheduledItem) {
  return {
    schedule_id: task.id,
    title: task.title,
    label: scheduleLabel(task, AGENT),
    paused: task.state === 'paused',
    next_run_at: task.state === 'paused' ? null : (task.occurredAt?.toISOString() ?? null),
    last_run_outcome: task.latestReviewOutcome,
    finished: task.state === 'finished',
    stale: task.state === 'stale',
  };
}

function toAccessSummary(task: ScheduleAccess) {
  const state = scheduleState(task, new Date());
  return {
    schedule_id: task.id,
    title: task.title,
    label: scheduleLabel(task, AGENT),
    paused: state === 'paused',
    next_run_at: task.status === 'paused' ? null : (task.nextRunAt?.toISOString() ?? null),
    last_run_outcome: task.latestReviewOutcome,
    finished: state === 'finished',
    stale: state === 'stale',
  };
}

export const createScheduleTool: CustomTool<
  CreateInput,
  z.infer<typeof CreateScheduleOutputSchema>
> = {
  ...CREATE_SCHEDULE_DECL,
  inputSchema: CreateScheduleInputSchema,
  outputSchema: CreateScheduleOutputSchema,
  async handler(input, ctx) {
    if ((input.cron === undefined) === (input.run_at === undefined)) {
      throw new ToolError('TOOL_INPUT_INVALID', 'Provide exactly one of cron or run_at.', {});
    }
    const caller = await resolveScheduleContext({
      ...ctx,
      includeTimeZone: input.timezone === undefined,
    });
    const timeZone = input.timezone ?? caller.timezone;
    if (!timeZone) {
      throw new ToolError('UNEXPECTED', 'Could not resolve a timezone for the schedule', {});
    }
    const runAt = input.run_at ? new Date(input.run_at) : undefined;
    const common = {
      workspaceId: ctx.workspaceId,
      createdByUserId: ctx.userId,
      organizationId: caller.organizationId,
      title: input.title,
      description: input.prompt,
      tier: input.tier ?? caller.tier,
      autoApprove: false,
      notification: 'email_app',
      triggerType: 'schedule',
      successCriteria: input.success_criteria ?? null,
      timezone: timeZone,
    } as const;
    let taskId: string;
    if (input.cron) {
      ({ taskId } = await createTask({ ...common, cron: input.cron }));
    } else if (runAt) {
      ({ taskId } = await createTask({ ...common, runAt }));
    } else {
      throw new ToolError('TOOL_INPUT_INVALID', 'Provide exactly one of cron or run_at.', {});
    }
    const created = await requireScheduleAccess(taskId, ctx, 'write');
    return {
      schedule_id: created.id,
      next_run_at: created.nextRunAt?.toISOString() ?? null,
      label: scheduleLabel(created, AGENT),
    };
  },
};

export const listSchedulesTool: CustomTool<
  z.infer<typeof ListSchedulesInputSchema>,
  z.infer<typeof ListSchedulesOutputSchema>
> = {
  ...LIST_SCHEDULES_DECL,
  inputSchema: ListSchedulesInputSchema,
  outputSchema: ListSchedulesOutputSchema,
  async handler(_input, ctx) {
    const groups = await listScheduledItems({
      workspaceId: ctx.workspaceId,
      viewerUserId: ctx.userId,
    });
    const schedules = groups.upcoming.filter((task) => task.triggerType === 'schedule');
    const visible = await Promise.all(
      schedules.map(async (task) => ({
        task,
        access: await getScheduleAccess({
          taskId: task.id,
          workspaceId: ctx.workspaceId,
        }),
      })),
    );
    return {
      schedules: visible
        .filter(
          ({ access }) =>
            access && (access.createdByUserId === ctx.userId || access.visibility === 'workspace'),
        )
        .map(({ task }) => toSummary(task)),
    };
  },
};

export const updateScheduleTool: CustomTool<
  UpdateInput,
  z.infer<typeof UpdateScheduleOutputSchema>
> = {
  ...UPDATE_SCHEDULE_DECL,
  inputSchema: UpdateScheduleInputSchema,
  outputSchema: UpdateScheduleOutputSchema,
  async handler(input, ctx) {
    const access = await requireScheduleAccess(input.schedule_id, ctx, 'write');
    const current = requireSchedule(
      await getTaskForEdit({
        taskId: input.schedule_id,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
      }),
      { taskId: input.schedule_id },
    );
    if (input.cron !== undefined && input.run_at !== undefined) {
      throw new ToolError('TOOL_INPUT_INVALID', 'Provide either cron or run_at, not both.', {
        taskId: input.schedule_id,
      });
    }
    const hasDefinitionChange = [
      input.title,
      input.prompt,
      input.cron,
      input.run_at,
      input.timezone,
      input.success_criteria,
      input.tier,
    ].some((value) => value !== undefined);
    if (hasDefinitionChange) {
      const caller = await resolveScheduleContext({ ...ctx, includeTimeZone: false });
      const requestedRunAt = input.run_at ? new Date(input.run_at) : undefined;
      let schedule: { cron: string } | { runAt: Date };
      if (input.cron) schedule = { cron: input.cron };
      else if (requestedRunAt) schedule = { runAt: requestedRunAt };
      else if (current.runAt) schedule = { runAt: current.runAt };
      else if (current.cron) schedule = { cron: current.cron };
      else {
        throw new ToolError('UNEXPECTED', 'Schedule has no time', {
          taskId: input.schedule_id,
        });
      }
      await updateTask({
        expectedVersion: current.version,
        paused: input.paused,
        userId: ctx.userId,
        taskId: input.schedule_id,
        workspaceId: ctx.workspaceId,
        organizationId: caller.organizationId,
        title: input.title ?? current.title,
        description: input.prompt ?? current.description,
        ...(input.success_criteria !== undefined
          ? { successCriteria: input.success_criteria }
          : {}),
        tier: input.tier ?? current.tier,
        autoApprove: false,
        notification: current.notification,
        ...schedule,
        timezone: input.timezone ?? current.timezone,
      });
    }
    if (!hasDefinitionChange && input.paused === true && access.status !== 'paused') {
      await pauseTask({
        taskId: input.schedule_id,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
      });
    } else if (!hasDefinitionChange && input.paused === false && access.status === 'paused') {
      await resumeTask({
        taskId: input.schedule_id,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
      });
    }
    return toAccessSummary(await requireScheduleAccess(input.schedule_id, ctx, 'read'));
  },
};

export const deleteScheduleTool: CustomTool<
  z.infer<typeof DeleteScheduleInputSchema>,
  z.infer<typeof DeleteScheduleOutputSchema>
> = {
  ...DELETE_SCHEDULE_DECL,
  inputSchema: DeleteScheduleInputSchema,
  outputSchema: DeleteScheduleOutputSchema,
  async handler({ schedule_id, title }, ctx) {
    const access = await requireScheduleAccess(schedule_id, ctx, 'write');
    if (access.title !== title) {
      throw new ToolError('TOOL_INPUT_INVALID', 'Schedule title does not match', {
        taskId: schedule_id,
        expectedTitle: access.title,
        providedTitle: title,
      });
    }
    await deleteTask({ taskId: schedule_id, workspaceId: ctx.workspaceId, userId: ctx.userId });
    return { schedule_id, title, deleted: true };
  },
};
