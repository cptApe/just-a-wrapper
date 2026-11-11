// Parked sessions can be idle, so pending confirmations identify tool gates.
// requires_input includes provider MCP and built-in gates.
// Only sessions with an Anthropic ID are openable; links use the local session ID.

import 'server-only';
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { pendingConfirmation, session as sessionTable, task as taskTable } from '@/db/schema';
import { sessionVisibleToViewer } from '@/features/sessions/api/session-visibility';
import { taskVisibleToViewer } from '@/features/tasks/api/task-visibility';
import {
  ATTENTION_LIMIT,
  FINISHED_SCHEDULE_LIMIT,
  HISTORY_LIMIT,
  UPCOMING_LIMIT,
} from '@/features/tasks/constants';

const hasPendingGate = sql<boolean>`exists (
  select 1 from ${pendingConfirmation}
  where ${pendingConfirmation.sessionId} = ${sessionTable.id}
    and ${pendingConfirmation.status} = 'pending'
)`;

const taskFields = {
  id: taskTable.id,
  title: taskTable.title,
  icon: taskTable.icon,
  description: taskTable.description,
  successCriteria: taskTable.successCriteria,
  nextRunAt: taskTable.nextRunAt,
  triggerType: taskTable.triggerType,
  status: taskTable.status,
  cronSchedule: taskTable.cronSchedule,
  runAt: taskTable.runAt,
  timezone: taskTable.timezone,
  lastRunAt: taskTable.lastRunAt,
  eventType: taskTable.eventType,
  updatedAt: taskTable.updatedAt,
};

const sessionFields = {
  id: sessionTable.id,
  taskId: taskTable.id,
  title: sessionTable.title,
  endedAt: sessionTable.endedAt,
  lastEventAt: sessionTable.lastEventAt,
  createdAt: sessionTable.createdAt,
  reviewOutcome: sessionTable.reviewOutcome,
  status: sessionTable.status,
  stopReason: sessionTable.stopReason,
  taskTitle: taskTable.title,
  taskIcon: taskTable.icon,
};

// Attention includes ordinary chats: any session waiting on the user belongs in this inbox.
export function listAttentionRows(workspaceId: string, viewerUserId: string) {
  return db
    .select({ ...sessionFields, pendingGate: hasPendingGate })
    .from(sessionTable)
    .leftJoin(
      taskTable,
      and(
        eq(taskTable.id, sessionTable.taskId),
        taskVisibleToViewer(viewerUserId),
        eq(taskTable.workspaceId, sessionTable.workspaceId),
      ),
    )
    .where(
      and(
        eq(sessionTable.workspaceId, workspaceId),
        isNull(sessionTable.hiddenAt),
        sessionVisibleToViewer(viewerUserId),
        isNotNull(sessionTable.anthropicSessionId),
        ne(sessionTable.status, 'terminated'),
        or(
          inArray(sessionTable.status, [
            'pausing',
            'paused_no_credits',
            'resuming',
            'requires_input',
          ]),
          hasPendingGate,
        ),
      ),
    )
    .orderBy(sql`${sessionTable.lastEventAt} desc nulls last`, desc(sessionTable.createdAt))
    .limit(ATTENTION_LIMIT);
}

export function listActiveTaskRows(workspaceId: string, viewerUserId: string) {
  return db
    .select(taskFields)
    .from(taskTable)
    .where(
      and(
        eq(taskTable.workspaceId, workspaceId),
        taskVisibleToViewer(viewerUserId),
        inArray(taskTable.status, ['upcoming', 'paused', 'running']),
        // Paused schedules, and resumed ones the provider has not answered yet, have no next run.
        or(
          isNotNull(taskTable.nextRunAt),
          eq(taskTable.triggerType, 'event'),
          inArray(taskTable.status, ['paused', 'running']),
          ne(taskTable.providerSync, 'synced'),
        ),
      ),
    )
    .orderBy(sql`${taskTable.nextRunAt} asc nulls last`, desc(taskTable.createdAt))
    .limit(UPCOMING_LIMIT);
}

// Cap completed one-offs separately so they cannot crowd active schedules out of the page.
export function listFinishedTaskRows(workspaceId: string, viewerUserId: string) {
  return db
    .select(taskFields)
    .from(taskTable)
    .where(
      and(
        eq(taskTable.workspaceId, workspaceId),
        taskVisibleToViewer(viewerUserId),
        eq(taskTable.status, 'done'),
        eq(taskTable.triggerType, 'schedule'),
        isNotNull(taskTable.runAt),
      ),
    )
    .orderBy(desc(taskTable.runAt), desc(taskTable.updatedAt))
    .limit(FINISHED_SCHEDULE_LIMIT);
}

export function listHistoryRows(workspaceId: string, viewerUserId: string) {
  return db
    .select(sessionFields)
    .from(sessionTable)
    .leftJoin(
      taskTable,
      and(
        eq(taskTable.id, sessionTable.taskId),
        taskVisibleToViewer(viewerUserId),
        eq(taskTable.workspaceId, sessionTable.workspaceId),
      ),
    )
    .where(
      and(
        eq(sessionTable.workspaceId, workspaceId),
        isNull(sessionTable.hiddenAt),
        sessionVisibleToViewer(viewerUserId),
        eq(sessionTable.kind, 'task_run'),
        isNotNull(sessionTable.anthropicSessionId),
        // Already-executed only: running/rescheduling are in flight and
        // paused_no_credits belongs to the attention group.
        inArray(sessionTable.status, ['idle', 'terminated']),
      ),
    )
    .orderBy(
      sql`coalesce(${sessionTable.endedAt}, ${sessionTable.lastEventAt}, ${sessionTable.createdAt}) desc`,
    )
    .limit(HISTORY_LIMIT);
}
