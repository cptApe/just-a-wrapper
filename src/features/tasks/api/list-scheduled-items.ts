import 'server-only';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';
import { sessionVisibleToViewer } from '@/features/sessions/api/session-visibility';
import type {
  AttentionItem,
  ScheduledGroups,
  SessionScheduledItem,
  TaskScheduledItem,
} from '@/features/tasks/types';
import { scheduleState } from '../lib/schedule-state';
import {
  listActiveTaskRows,
  listAttentionRows,
  listFinishedTaskRows,
  listHistoryRows,
} from './list-scheduled-rows';

// The caller must resolve and authorize the workspace before loading these groups.
export async function listScheduledItems(input: {
  workspaceId: string;
  viewerUserId: string;
}): Promise<ScheduledGroups> {
  const [attentionRows, activeRows, finishedRows, historyRows] = await Promise.all([
    listAttentionRows(input.workspaceId, input.viewerUserId),
    listActiveTaskRows(input.workspaceId, input.viewerUserId),
    listFinishedTaskRows(input.workspaceId, input.viewerUserId),
    listHistoryRows(input.workspaceId, input.viewerUserId),
  ]);

  const upcomingRows = [...activeRows, ...finishedRows];

  // Keep task-run summaries in explicit grouped / DISTINCT ON queries so both
  // values share the same completed-run filter and latest-run ordering.
  const { runCountsByTask, latestReviewByTask } = await loadRunSummaries(
    upcomingRows.map((row) => row.id),
    input.viewerUserId,
  );

  const attention = attentionRows.map(toAttentionItem);

  const attentionIds = new Set(attention.map((item) => item.id));
  const history = historyRows.filter((row) => !attentionIds.has(row.id)).map(toHistoryItem);
  const runsByTaskId = new Map<string, SessionScheduledItem[]>();
  for (const run of history) {
    if (run.taskId === null) continue;
    const runs = runsByTaskId.get(run.taskId) ?? [];
    runs.push(run);
    runsByTaskId.set(run.taskId, runs);
  }

  const now = new Date();
  const upcoming: TaskScheduledItem[] = upcomingRows.map((row) => {
    const state = scheduleState(row, now);
    return {
      source: 'task',
      icon: row.icon,
      id: row.id,
      href: null,
      title: row.title,
      description: row.description,
      occurredAt: row.nextRunAt,
      triggerType: row.triggerType,
      state,
      status: row.status,
      cronSchedule: row.cronSchedule,
      eventType: row.eventType,
      runAt: row.runAt,
      timezone: row.timezone,
      updatedAt: row.updatedAt,
      timesRun: runCountsByTask.get(row.id) ?? 0,
      latestReviewOutcome: row.successCriteria ? (latestReviewByTask.get(row.id) ?? null) : null,
      runs: runsByTaskId.get(row.id) ?? [],
    };
  });

  // A parked idle task_run appears only in attention. A recurring task may
  // appear in both upcoming and history when it has a completed run.
  return { attention, upcoming, history };
}

async function loadRunSummaries(taskIds: string[], viewerUserId: string) {
  const completedRunFilter = and(
    inArray(sessionTable.taskId, taskIds),
    isNull(sessionTable.hiddenAt),
    sessionVisibleToViewer(viewerUserId),
    eq(sessionTable.kind, 'task_run'),
    inArray(sessionTable.status, ['idle', 'terminated']),
  );
  const [runCounts, latestRuns] = taskIds.length
    ? await Promise.all([
        db
          .select({ taskId: sessionTable.taskId, timesRun: count() })
          .from(sessionTable)
          .where(completedRunFilter)
          .groupBy(sessionTable.taskId),
        db
          .selectDistinctOn([sessionTable.taskId], {
            taskId: sessionTable.taskId,
            reviewOutcome: sessionTable.reviewOutcome,
          })
          .from(sessionTable)
          .where(completedRunFilter)
          .orderBy(
            sessionTable.taskId,
            sql`coalesce(${sessionTable.endedAt}, ${sessionTable.lastEventAt}, ${sessionTable.createdAt}) desc`,
          ),
      ])
    : [[], []];
  const runCountsByTask = new Map(runCounts.map((row) => [row.taskId, row.timesRun]));
  const latestReviewByTask = new Map(latestRuns.map((row) => [row.taskId, row.reviewOutcome]));

  return { runCountsByTask, latestReviewByTask };
}

function toAttentionItem(
  row: Awaited<ReturnType<typeof listAttentionRows>>[number],
): AttentionItem {
  return {
    source: 'session',
    id: row.id,
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    taskIcon: row.taskIcon,
    href: `/app/task/${row.id}`,
    title: row.title,
    occurredAt: row.lastEventAt ?? row.createdAt,
    reviewOutcome: row.reviewOutcome,
    // Credit exhaustion outranks a parked gate — there's no resuming the gate
    // without credits anyway.
    reason:
      row.status === 'pausing' || row.status === 'paused_no_credits' || row.status === 'resuming'
        ? 'out_of_credits'
        : 'tool_gate',
  };
}

function toHistoryItem(
  row: Awaited<ReturnType<typeof listHistoryRows>>[number],
): SessionScheduledItem {
  return {
    source: 'session',
    id: row.id,
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    taskIcon: row.taskIcon,
    status:
      row.reviewOutcome === 'not_passed' || row.stopReason === 'retries_exhausted'
        ? 'failed'
        : row.reviewOutcome !== null
          ? 'succeeded'
          : row.status === 'terminated' ||
              row.stopReason === 'interrupted' ||
              row.stopReason === 'budget_reached'
            ? 'stopped'
            : 'succeeded',
    href: `/app/task/${row.id}`,
    title: row.title,
    occurredAt: historyTime(row),
    reviewOutcome: row.reviewOutcome,
  };
}

function historyTime(row: Awaited<ReturnType<typeof listHistoryRows>>[number]): Date {
  if (row.endedAt) return row.endedAt;
  return row.lastEventAt ?? row.createdAt;
}
