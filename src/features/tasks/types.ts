import type { z } from 'zod';
import type { AgentTier } from '@/features/agents';
import type { Repeats } from './lib/build-cron';
import type { editableTaskSchema } from './lib/editable-task-schema';
import type { ScheduleState } from './lib/schedule-state';
import type { triggerDeliverySchema } from './lib/trigger-delivery';

// Task domain types — the write side of /scheduled (creation, lifecycle,
// run adoption). The read-side list shapes for the scheduled page follow below.

export type ReviewOutcome = 'passed' | 'passed_after_revision' | 'not_passed';

import type { TaskNotification } from '@/features/notifications/lib/task-notification';
import type { TaskAttachments } from './lib/task-attachments';

export type { TaskAttachments } from './lib/task-attachments';

type CreateTaskBase = {
  workspaceId: string;
  createdByUserId: string;
  organizationId: string;
  title: string;
  icon?: string | null;
  /** The kickoff prompt — sent as the run session's opening user message. */
  description: string;
  tier: AgentTier;
  /** true → run sessions get permission_mode='auto' (tools fire unconfirmed). */
  autoApprove: boolean;
  notification: TaskNotification;
  /** Library files and folders every run starts with. */
  attachments?: TaskAttachments | null;
};

type CreateScheduleTaskBase = CreateTaskBase & {
  triggerType: 'schedule';
  /** Optional completion rubric for Anthropic's deployment outcome review. */
  successCriteria: string | null;
  /** IANA timezone used for cron evaluation and one-off display. */
  timezone: string;
};

export type CreateScheduleTaskInput = CreateScheduleTaskBase &
  ({ cron: string; runAt?: never } | { cron?: never; runAt: Date });

export type CreateEventTaskInput = CreateTaskBase & {
  triggerType: 'event';
  /** Composio toolkit slug (lowercase), e.g. 'gmail'. */
  toolkit: string;
  /** Composio trigger-type slug (uppercase), e.g. 'GMAIL_NEW_GMAIL_MESSAGE'. */
  eventType: string;
};

export type CreateTaskInput = CreateScheduleTaskInput | CreateEventTaskInput;

export type CreatedTask = { taskId: string };

export type EditableTask = z.infer<typeof editableTaskSchema>;

export type UpdateTaskInput = {
  /** The version the editor read. A newer write in between refuses the edit with CONFLICT. */
  expectedVersion: number;
  paused?: boolean;
  userId: string;
  taskId: string;
  workspaceId: string;
  /** The org the deployment context resolves in (the caller's active org). The
      task's ORIGINAL creator is read from the row, so member-scoped vault/memory
      never repoint to whoever edits. */
  organizationId: string;
  title: string;
  icon?: string | null;
  description: string;
  /** Schedule-only; null clears the deployment outcome definition. */
  successCriteria?: string | null;
  tier?: AgentTier;
  autoApprove?: boolean;
  notification?: TaskNotification;
  attachments?: TaskAttachments | null;
  /** Required for schedule tasks, ignored for event tasks. */
  cron?: string;
  /** Target one-off instant. Supplying it converts a recurring schedule to one-off. */
  runAt?: Date;
  timezone?: string | null;
};

export type TriggerInput = {
  /** The signed webhook-id header, never the payload's event id. */
  deliveryId: string;
  triggerId: string;
  triggerSlug: string;
  payload: unknown;
};

export type TriggerOutcome =
  | { handled: true; sessionId: string }
  | {
      handled: false;
      reason:
        | 'unknown_trigger'
        | 'task_not_active'
        | 'delivery_in_progress'
        | 'delivery_ambiguous'
        | 'delivery_failed'
        | 'run_limit'
        | 'credits'
        | 'member_limit';
    };

export type TriggerDelivery = z.infer<typeof triggerDeliverySchema>;

// Discriminated sources represent the items grouped by the scheduled page.

/** A run that already executed (or is parked) — backed by a `session` row. */
export type SessionScheduledItem = {
  source: 'session';
  /** Joined definition metadata, including definitions outside the Tasks window. */
  taskTitle?: string | null;
  taskIcon?: string | null;
  status?: 'succeeded' | 'failed' | 'stopped';
  /** Local `session` row id. */
  id: string;
  /** The schedule definition that produced this run; null for attention-only chats. */
  taskId: string | null;
  /** The session's transcript: `/app/task/<session uuid>`. */
  href: string;
  title: string | null;
  /** Where the item sits in time — last activity (attention) or run completion (history). */
  occurredAt: Date;
  /** Terminal outcome review, or null when this run had no criteria. */
  reviewOutcome: ReviewOutcome | null;
};

/** A standing scheduled/event-triggered task — backed by a `task` row. */
export type TaskScheduledItem = {
  source: 'task';
  /** Local `task` row id. */
  id: string;
  /** Task definitions open through the schedule-detail overlay, not a route. */
  href: null;
  title: string;
  icon?: string | null;
  /** The prompt the agent runs — the Tasks-tab card excerpt. */
  description: string | null;
  /**
   * The task's next fire time (from the deployment schedule). Null for
   * event-triggered standing tasks (they fire when the event does) and for
   * paused schedules.
   */
  occurredAt: Date | null;
  triggerType: 'schedule' | 'event';
  /** Paused tasks stay listed (resumable from the row menu) but don't fire. */
  state: ScheduleState;
  status: typeof import('@/db/schema').task.$inferSelect['status'];
  /** The recurring cron expression; null for one-off and event tasks. */
  cronSchedule: string | null;
  /** The provider event that starts an event task; null for schedules. */
  eventType: string | null;
  /** Stored instant for a one-off schedule; null for recurring and event tasks. */
  runAt: Date | null;
  /** IANA timezone for rendering a one-off wall-clock date. */
  timezone: string | null;
  /** Last definition change — the list table's "Last modified" column. */
  updatedAt: Date;
  /** Completed `task_run` sessions for this task — the "Times run" column. */
  timesRun: number;
  /** The newest completed run's review, shown on the task card when present. */
  latestReviewOutcome: ReviewOutcome | null;
  /** Recent completed runs for this definition, newest first. */
  runs: SessionScheduledItem[];
};

export type ScheduledItem = SessionScheduledItem | TaskScheduledItem;

export type AttentionReason = 'out_of_credits' | 'tool_gate';

/** A session that can't continue until the user acts. */
export type AttentionItem = SessionScheduledItem & { reason: AttentionReason };

export type ScheduledGroups = {
  /** Sessions paused on credit exhaustion or parked on an unresolved tool gate. */
  attention: AttentionItem[];
  /** Active, paused, stale, running, and recently finished task definitions. */
  upcoming: TaskScheduledItem[];
  /** Already-executed `task_run` sessions, newest first. */
  history: SessionScheduledItem[];
};

export type ScheduledRunRow = {
  run: SessionScheduledItem;
  taskTitle: string;
  taskIcon: string | null;
  status: 'succeeded' | 'failed' | 'stopped' | AttentionReason;
};

export type EventSelection = { toolkit: string; eventType: string };
export type TriggerChoice = Repeats | 'once' | 'event';
export type SaveVars = { body: unknown; successToast: string } & (
  | { kind: 'create'; optimisticRow: TaskScheduledItem }
  | {
      kind: 'edit';
      taskId: string;
      rowPatch: Partial<TaskScheduledItem>;
      updatedEditable: EditableTask;
    }
);
