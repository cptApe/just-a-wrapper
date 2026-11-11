import { requestBudgetSync } from '@/features/billing/api/budget-sync-transitions';
import { pauseSessionForInsufficientCredits } from '@/features/billing/api/pause-session-on-exhaustion';
import { checkSpend } from '@/features/billing/api/spend-gate';
import { requireSessionBudgetRefresh } from '@/features/billing/api/sync-session-budgets';
import { insertSession } from '@/features/sessions/api/session-transitions';
import { BillingError } from '@/lib/errors';
import 'server-only';
import type { ChatStatus } from '@/lib/chat-status';
// Match both metadata.task_id and deployment_id so unrelated sessions cannot claim a task.
// Run-now and webhooks can race; the unique session ID makes adoption idempotent.

import Anthropic, { APIError } from '@anthropic-ai/sdk';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  processedWebhookEvent,
  session as sessionTable,
  task as taskTable,
  workspace,
  workspaceNotDeleted,
} from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { schedulePublishSessionEvent } from '@/features/realtime/server';
import { shipLog } from '@/lib/logger';
import { extend } from '@/lib/request-context';
import { syncTaskProvider } from './sync-task-provider';
import { moveTask, refreshRecurringTaskTimes } from './task-transitions';

const ANTHROPIC_STATUS_TO_ROW = {
  running: 'running',
  idle: 'idle',
  rescheduling: 'rescheduling',
  terminated: 'terminated',
} as const;

type AdoptOutcome =
  | { adopted: true; taskId: string; sessionRowId: string }
  | {
      adopted: false;
      reason: 'not_a_task_session' | 'task_not_found' | 'deployment_mismatch' | 'workspace_deleted';
    };

type AnthropicSession = Anthropic.Beta.BetaManagedAgentsSession;
type AdoptableTask = NonNullable<Awaited<ReturnType<typeof readAdoptableTask>>>;
type RunRowStatus = (typeof ANTHROPIC_STATUS_TO_ROW)[keyof typeof ANTHROPIC_STATUS_TO_ROW];

/**
 * Adopt `anthropicSession` as a task_run row if its metadata maps to one of our
 * tasks. Safe to call for ANY session — non-task sessions return
 * `{adopted:false}` without side effects.
 */
export async function adoptTaskRunSession(
  anthropicSession: AnthropicSession,
): Promise<AdoptOutcome> {
  const taskId = anthropicSession.metadata.task_id;
  if (!taskId) {
    return { adopted: false, reason: 'not_a_task_session' };
  }

  const task = await readAdoptableTask(taskId);
  if (!task) {
    // metadata.task_id that maps to nothing — either a deleted task or a bag we
    // never wrote. Logged loudly; never an insert.
    shipLog({
      level: 'warn',
      msg: 'task_run.adopt.unknown_task',
      feature: 'tasks',
      op: 'adopt',
      task_id: taskId,
      session_id: anthropicSession.id,
    });
    return { adopted: false, reason: 'task_not_found' };
  }
  if (task.liveWorkspaceId === null) return { adopted: false, reason: 'workspace_deleted' };
  const ownership = await checkSessionOwnership(task, anthropicSession);
  if (!ownership.owned) return { adopted: false, reason: 'deployment_mismatch' };

  extend({ task_id: task.id, session_id: anthropicSession.id });

  const isCancelled = task.status === 'removed';
  const status = isCancelled ? 'terminated' : ANTHROPIC_STATUS_TO_ROW[anthropicSession.status];
  await startOneShotRun(task, anthropicSession);
  const inserted = await insertRunRow(task, anthropicSession, {
    status,
    isCancelled,
    eventSessionId: ownership.eventSessionId,
  });
  const pausedForCredits = await pauseRefusedRun(task, anthropicSession, status);

  const sessionRowId = inserted.at(0)?.id;
  if (sessionRowId) {
    shipLog({
      msg: 'task_run.adopted',
      feature: 'tasks',
      op: 'adopt',
      task_id: task.id,
      session_id: anthropicSession.id,
      status,
    });
    // Keyed on OUR session uuid — what the sidebar + chat consumers
    // match. The run session inherits the task's visibility + creator, so route
    // the status on the right channel.
    if (!isCancelled && !pausedForCredits)
      await announceRun(task.workspaceId, sessionRowId, status, {
        visibility: task.visibility,
        createdByUserId: task.createdByUserId,
      });
    if (!task.runAt && task.anthropicDeploymentId)
      await refreshTaskRunTimes(task.id, task.anthropicDeploymentId);
  }
  // A fired one-off keeps no live deployment; the sync archives it before it can repeat.
  if (task.runAt && task.anthropicDeploymentId) await syncTaskProvider(task.id);
  if (sessionRowId) return { adopted: true, taskId: task.id, sessionRowId };

  // Already adopted by the other path — resolve the existing row id.
  const existing = (
    await db
      .select({ id: sessionTable.id })
      .from(sessionTable)
      .where(eq(sessionTable.anthropicSessionId, anthropicSession.id))
      .limit(1)
  ).at(0);
  return existing
    ? { adopted: true, taskId: task.id, sessionRowId: existing.id }
    : { adopted: false, reason: 'task_not_found' };
}

async function readAdoptableTask(taskId: string) {
  return (
    await db
      .select({
        id: taskTable.id,
        liveWorkspaceId: workspace.id,
        workspaceMemoryStoreId: workspace.workspaceMemoryStoreId,
        status: taskTable.status,
        triggerType: taskTable.triggerType,
        workspaceId: taskTable.workspaceId,
        createdByUserId: taskTable.createdByUserId,
        tier: taskTable.tier,
        autoApprove: taskTable.autoApprove,
        visibility: taskTable.visibility,
        title: taskTable.title,
        anthropicDeploymentId: taskTable.anthropicDeploymentId,
        runAt: taskTable.runAt,
      })
      .from(taskTable)
      .leftJoin(workspace, and(eq(workspace.id, taskTable.workspaceId), workspaceNotDeleted))
      .where(eq(taskTable.id, taskId))
      .limit(1)
  ).at(0);
}

// Event runs prove ownership through their webhook receipt; scheduled runs through the deployment.
async function checkSessionOwnership(
  task: AdoptableTask,
  anthropicSession: AnthropicSession,
): Promise<{ owned: false } | { owned: true; eventSessionId: string | null }> {
  if (task.triggerType === 'event') {
    const appSessionId = anthropicSession.metadata.app_session_id;
    const claim = (
      await db
        .select({ eventId: processedWebhookEvent.eventId })
        .from(processedWebhookEvent)
        .where(
          and(
            eq(processedWebhookEvent.provider, 'composio'),
            sql`${processedWebhookEvent.payload}->>'taskId' = ${task.id}`,
            sql`${processedWebhookEvent.payload}->>'sessionId' = ${appSessionId}`,
          ),
        )
        .limit(1)
    ).at(0);
    if (!claim || !appSessionId) return { owned: false };
    return { owned: true, eventSessionId: appSessionId };
  }
  if (!task.anthropicDeploymentId || anthropicSession.deployment_id !== task.anthropicDeploymentId)
    return { owned: false };
  return { owned: true, eventSessionId: null };
}

async function startOneShotRun(
  task: AdoptableTask,
  anthropicSession: AnthropicSession,
): Promise<void> {
  if (!task.runAt || !task.anthropicDeploymentId) return;
  if (task.status !== 'upcoming') return;
  await moveTask(db, {
    taskId: task.id,
    to: 'running',
    sync: 'status',
    nextRunAt: null,
    lastRunAt: new Date(anthropicSession.created_at),
  });
}

async function insertRunRow(
  task: AdoptableTask,
  anthropicSession: AnthropicSession,
  run: { status: RunRowStatus; isCancelled: boolean; eventSessionId: string | null },
) {
  const now = new Date();
  const memoryMount = anthropicSession.resources
    .filter((resource) => resource.type === 'memory_store')
    .find((resource) => resource.memory_store_id === task.workspaceMemoryStoreId);
  return db.transaction(async (tx) => {
    const rows = await insertSession(tx, {
      ...(run.eventSessionId === null ? {} : { id: run.eventSessionId }),
      workspaceId: task.workspaceId,
      createdByUserId: task.createdByUserId,
      workspaceMemoryAccess: memoryMount ? (memoryMount.access ?? 'read_write') : 'none',
      tier: task.tier,
      // auto_approve is a task setting. The tool gate enforces only the session's permission_mode.
      permissionMode: task.autoApprove ? 'auto' : 'ask',
      visibility: task.visibility,
      kind: 'task_run',
      taskId: task.id,
      anthropicSessionId: anthropicSession.id,
      title: task.title,
      status: run.status,
      startedAt: new Date(anthropicSession.created_at),
      lastEventAt: new Date(anthropicSession.created_at),
      ...(run.status === 'terminated' ? { endedAt: now } : {}),
      ...(run.isCancelled ? { hiddenAt: now } : {}),
    });
    if (rows.length > 0 && (run.status === 'running' || run.status === 'rescheduling'))
      await requestBudgetSync(tx, task.workspaceId);
    return rows;
  });
}

// The provider starts scheduled runs, so the spend gate runs at adoption and a refused run is
// paused with its reason. An already-idle run must complete even when its last turn spent the
// remaining credits.
async function pauseRefusedRun(
  task: AdoptableTask,
  anthropicSession: AnthropicSession,
  status: RunRowStatus,
): Promise<boolean> {
  if (status !== 'running' && status !== 'rescheduling') return false;
  const refusal = await checkSpend({
    entry: task.triggerType === 'event' ? 'event_run' : 'scheduled_run',
    workspaceId: task.workspaceId,
    userId: task.createdByUserId,
  });
  if (refusal) return pauseSessionForInsufficientCredits(anthropicSession.id, refusal.reason);
  try {
    await requireSessionBudgetRefresh(task.workspaceId, anthropicSession.id);
    return false;
  } catch (error) {
    if (!(error instanceof BillingError && error.code === 'CREDITS_EXHAUSTED')) throw error;
    return pauseSessionForInsufficientCredits(anthropicSession.id, 'credits');
  }
}

export async function adoptTaskRunBySessionId(
  anthropicSessionId: string,
): Promise<AdoptOutcome | null> {
  // Known sessions (every chat we created, an already-adopted run) skip the
  // retrieve — status_run_started fires for ALL sessions, so this guard keeps
  // the webhook from paying an API read per chat message session.
  const known = (
    await db
      .select({ id: sessionTable.id, taskId: sessionTable.taskId })
      .from(sessionTable)
      .where(eq(sessionTable.anthropicSessionId, anthropicSessionId))
      .limit(1)
  ).at(0);
  if (known) {
    return known.taskId
      ? { adopted: true, taskId: known.taskId, sessionRowId: known.id }
      : { adopted: false, reason: 'not_a_task_session' };
  }

  const client = requireAnthropicClient();
  let anthropicSession;
  try {
    anthropicSession = await client.beta.sessions.retrieve(anthropicSessionId);
  } catch (error) {
    // Inaccessible or deleted sessions cannot be adopted on webhook redelivery.
    if (error instanceof APIError && [401, 403, 404].includes(error.status ?? 0)) {
      shipLog({
        level: 'warn',
        msg: 'task_run.adopt.retrieve_ignored',
        feature: 'tasks',
        op: 'adopt-by-session-id',
        session_id: anthropicSessionId,
        status: error.status,
      });
      return null;
    }
    throw error;
  }
  return adoptTaskRunSession(anthropicSession);
}

export async function refreshTaskRunTimes(taskId: string, deploymentId: string): Promise<void> {
  const client = requireAnthropicClient();
  const deployment = await client.beta.deployments.retrieve(deploymentId);
  const next = deployment.schedule?.upcoming_runs_at?.[0];
  const last = deployment.schedule?.last_run_at;
  await refreshRecurringTaskTimes({
    taskId,
    nextRunAt: next ? new Date(next) : null,
    lastRunAt: last ? new Date(last) : null,
  });
}

// Private run updates go only to the creator channel, never the shared workspace channel.
async function announceRun(
  workspaceId: string,
  sessionId: string,
  status: ChatStatus,
  session: { visibility: 'private' | 'workspace'; createdByUserId: string },
): Promise<void> {
  const ws = (
    await db
      .select({ organizationId: workspace.organizationId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)
  ).at(0);
  if (ws)
    schedulePublishSessionEvent(
      { type: 'session_status', sessionId, status },
      { organizationId: ws.organizationId, session },
    );
}
