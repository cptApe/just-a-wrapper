import type { AgentTier } from '@/features/agents/types';
import type { TaskNotification } from '@/features/notifications/lib/task-notification';
import type {
  EditableTask,
  EventSelection,
  SaveVars,
  TaskAttachments,
  TaskScheduledItem,
  TriggerChoice,
} from '@/features/tasks/types';

type ScheduleSaveDraft = {
  trimmedTitle: string;
  trimmedDescription: string;
  trimmedSuccessCriteria: string;
  icon: string | null;
  mode: 'schedule' | 'event';
  tier: AgentTier;
  autoApprove: boolean;
  notification: TaskNotification;
  attachments: TaskAttachments | null;
  choice: TriggerChoice | null;
  runAt: Date | null;
  cron: string | null;
  timezone: string;
  eventSel: EventSelection | null;
};
function scheduleBody(draft: ScheduleSaveDraft) {
  return {
    title: draft.trimmedTitle,
    icon: draft.icon,
    description: draft.trimmedDescription,
    tier: draft.tier,
    autoApprove: draft.autoApprove,
    notification: draft.notification,
    attachments: draft.attachments,
    ...(draft.mode === 'schedule'
      ? {
          successCriteria: draft.trimmedSuccessCriteria || null,
          ...(draft.choice === 'once'
            ? { runAt: draft.runAt?.toISOString() }
            : { cron: draft.cron ?? '' }),
          timezone: draft.timezone,
        }
      : {}),
  };
}

export function buildScheduleEdit(initial: EditableTask, draft: ScheduleSaveDraft): SaveVars {
  const { mode, choice, cron, runAt, timezone } = draft;
  const fields = {
    title: draft.trimmedTitle,
    icon: draft.icon,
    description: draft.trimmedDescription,
  };
  const updatedEditable: EditableTask = {
    ...initial,
    ...fields,
    successCriteria: mode === 'schedule' ? draft.trimmedSuccessCriteria : '',
    tier: draft.tier,
    autoApprove: draft.autoApprove,
    notification: draft.notification,
    attachments: draft.attachments,
    ...(mode === 'schedule' ? { cron: choice === 'once' ? null : cron, runAt, timezone } : {}),
  };
  const rowPatch: Partial<TaskScheduledItem> = {
    ...fields,
    updatedAt: new Date(),
    // The event target is locked, so only a time-based edit changes the cadence.
    ...(mode === 'schedule'
      ? { cronSchedule: choice === 'once' ? null : cron, runAt, occurredAt: runAt }
      : {}),
  };
  return {
    kind: 'edit',
    taskId: initial.id,
    body: { ...scheduleBody(draft), version: initial.version },
    rowPatch,
    updatedEditable,
    successToast: 'Schedule updated',
  };
}

export function buildScheduleCreate(draft: ScheduleSaveDraft): SaveVars {
  const body = {
    ...scheduleBody(draft),
    triggerType: draft.mode,
    ...(draft.mode === 'event'
      ? { toolkit: draft.eventSel?.toolkit ?? '', eventType: draft.eventSel?.eventType ?? '' }
      : {}),
  };
  // The server computes the next run from the cron, so a recurring row reaches Calendar on refresh.
  const optimisticRow: TaskScheduledItem = {
    source: 'task',
    id: '',
    href: null,
    title: draft.trimmedTitle,
    icon: draft.icon,
    description: draft.trimmedDescription,
    occurredAt: draft.runAt,
    triggerType: draft.mode,
    state: 'live',
    status: 'creating',
    cronSchedule: draft.mode === 'schedule' ? draft.cron : null,
    eventType: draft.mode === 'event' ? (draft.eventSel?.eventType ?? null) : null,
    runAt: draft.runAt,
    timezone: draft.timezone,
    updatedAt: new Date(),
    timesRun: 0,
    latestReviewOutcome: null,
    runs: [],
  };
  return {
    kind: 'create',
    body,
    optimisticRow,
    successToast: draft.mode === 'schedule' ? 'Schedule saved' : 'Trigger saved',
  };
}
