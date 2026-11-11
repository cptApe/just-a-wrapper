// A sweep finishes provider syncs a request left behind, settles lost creates and run-now calls,
// and repairs missed one-off completion webhooks.
import 'server-only';
import { APIError } from '@anthropic-ai/sdk';
import { and, eq, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { processedWebhookEvent, session, task, workspace } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { AUTO_RESUME_CUTOFF_MS } from '@/features/billing/api/sync-session-budgets';
import { notificationChannels } from '@/features/notifications/lib/task-notification';
import { notify } from '@/features/notifications/server';
import { collectRecoveryFailures, DurableRecoveryError } from '@/lib/recover-rows';
import { assertBeforeDeadline, sweepDeadline } from '@/lib/sweep-deadline';
import { adoptTaskRunSession } from './adopt-task-run';
import { completeTaskRun } from './complete-task-run';
import { recoverTriggerDelivery } from './recover-trigger-delivery';
import { resolveRunNowLeases } from './resolve-run-now';
import { syncTaskProvider } from './sync-task-provider';
import {
  archiveDeployment,
  findTaskDeployments,
  firstUpcomingRun,
  listDeploymentSessions,
} from './task-deployments';
import {
  activateCreatedTask,
  moveTask,
  PROVIDER_SYNC_LEASE_MS,
  rejectCreatedTaskSchedule,
  removeUnavailableTask,
  type TaskRow,
} from './task-transitions';
import { resumeTriggerDelivery } from './trigger-delivery-transitions';

const GRACE_MS = 5 * 60_000;
// The request that wrote a mark pushes it itself; the sweep waits so it never races that push.
const SYNC_GRACE_MS = 60_000;

export async function reconcileTaskState(): Promise<void> {
  const deadline = sweepDeadline();
  const ago = (ms: number) => new Date(Date.now() - ms);
  const failures: unknown[] = [];
  const deliveries = await db
    .select({ eventId: processedWebhookEvent.eventId })
    .from(processedWebhookEvent)
    .where(
      and(
        eq(processedWebhookEvent.provider, 'composio'),
        lt(processedWebhookEvent.processedAt, ago(GRACE_MS)),
        sql`${processedWebhookEvent.payload}->>'state' in ('creating', 'ambiguous', 'session_created')`,
      ),
    )
    .orderBy(sql`random()`)
    .limit(25);
  failures.push(
    ...(await collectRecoveryFailures(
      deliveries,
      async (delivery) => {
        await recoverTriggerDelivery(delivery.eventId);
        await resumeTriggerDelivery(delivery.eventId);
      },
      { deadline },
    )),
  );
  const unsynced = await db
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        ne(task.providerSync, 'synced'),
        lt(task.updatedAt, ago(SYNC_GRACE_MS)),
        or(isNull(task.syncClaimedAt), lt(task.syncClaimedAt, ago(PROVIDER_SYNC_LEASE_MS))),
      ),
    )
    .orderBy(sql`${task.syncClaimedAt} asc nulls first`, task.id)
    .limit(25);
  failures.push(
    ...(await collectRecoveryFailures(
      unsynced,
      async (row) => void (await syncTaskProvider(row.id)),
      {
        deadline,
      },
    )),
  );
  const stuck = await db
    .select()
    .from(task)
    .where(
      and(
        lt(task.updatedAt, ago(GRACE_MS)),
        or(eq(task.status, 'creating'), eq(task.status, 'running')),
      ),
    )
    .orderBy(sql`random()`)
    .limit(25);
  failures.push(
    ...(await collectRecoveryFailures(
      stuck,
      (row) => (row.status === 'creating' ? reconcileTaskCreation(row) : repairRunCompletion(row)),
      { deadline },
    )),
  );
  const scheduled = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.status, 'upcoming'),
        eq(task.triggerType, 'schedule'),
        isNotNull(task.anthropicDeploymentId),
        lt(task.updatedAt, ago(GRACE_MS)),
        or(isNull(task.runAt), lt(task.runAt, ago(15 * 60_000))),
      ),
    )
    .orderBy(sql`${task.runAt} asc nulls last`, sql`${task.runsCheckedAt} asc nulls first`, task.id)
    .limit(25);
  failures.push(
    ...(await collectRecoveryFailures(
      scheduled,
      async (row) => {
        await db.update(task).set({ runsCheckedAt: new Date() }).where(eq(task.id, row.id));
        await recoverUnseenRuns(row, deadline);
      },
      { deadline },
    )),
  );
  failures.push(...(await resolveRunNowLeases(deadline)));
  failures.push(...(await reconcileExpiredCreditPauses(deadline)));
  if (failures.length > 0) throw new DurableRecoveryError(failures);
}

async function reconcileExpiredCreditPauses(deadline: number): Promise<unknown[]> {
  const expiredRuns = await db
    .select({ id: session.anthropicSessionId })
    .from(session)
    .where(
      and(
        eq(session.kind, 'task_run'),
        eq(session.status, 'paused_no_credits'),
        lt(session.pausedAt, new Date(Date.now() - AUTO_RESUME_CUTOFF_MS)),
        isNull(session.endedAt),
        isNotNull(session.anthropicSessionId),
      ),
    )
    .orderBy(sql`random()`)
    .limit(25);
  return collectRecoveryFailures(
    expiredRuns,
    async (run) => {
      if (run.id === null) return;
      await completeTaskRun({
        anthropicSessionId: run.id,
        outcome: 'idle',
        webhookEventId: `task-credit-pause-sweep:${run.id}`,
      });
    },
    { deadline },
  );
}

/** Removes a task whose run cannot be found and lets the sync archive what is left. */
async function removeAndSync(row: TaskRow): Promise<void> {
  await moveTask(db, { taskId: row.id, to: 'removed', sync: 'status', nextRunAt: null });
  await syncTaskProvider(row.id);
}

async function repairRunCompletion(row: TaskRow): Promise<void> {
  const deploymentId = row.anthropicDeploymentId;
  if (deploymentId === null) return;
  const runs = await db
    .select({ id: session.anthropicSessionId })
    .from(session)
    .where(and(eq(session.taskId, row.id), isNotNull(session.anthropicSessionId)));
  if (runs.length === 0) {
    for await (const upstream of listDeploymentSessions(deploymentId, row.createdAt)) {
      const adopted = await adoptTaskRunSession(upstream);
      if (adopted.adopted) runs.push({ id: upstream.id });
    }
  }
  if (runs.length === 0) return removeAndSync(row);
  for (const run of runs) {
    if (run.id === null) continue;
    let upstream;
    try {
      upstream = await requireAnthropicClient().beta.sessions.retrieve(
        run.id,
        {},
        { timeout: 30_000 },
      );
    } catch (error) {
      if (!(error instanceof APIError && error.status === 404)) throw error;
      return removeAndSync(row);
    }
    if (upstream.status !== 'idle' && upstream.status !== 'terminated') continue;
    await completeTaskRun({
      anthropicSessionId: run.id,
      outcome: upstream.status,
      webhookEventId: `task-sweep:${run.id}`,
    });
  }
}

async function reconcileTaskCreation(row: TaskRow): Promise<void> {
  // Metadata is the durable correlation key for a create whose response was lost.
  const deployment = (await findTaskDeployments(row)).at(0);
  if (!deployment) {
    await removeUnavailableTask(row.id);
    return;
  }
  const next = firstUpcomingRun(deployment);
  // An elapsed occurrence may already have fired while its create response was lost.
  // Attach it so the overdue-run sweep can discover that session before cleanup.
  if (row.runAt && row.runAt.getTime() > Date.now() && next?.getTime() !== row.runAt.getTime()) {
    if (await rejectCreatedTaskSchedule(row.id, deployment.id)) await syncTaskProvider(row.id);
    else await archiveDeployment(deployment.id);
    return;
  }
  const moved = await activateCreatedTask({
    taskId: row.id,
    deploymentId: deployment.id,
    nextRunAt: row.runAt ?? next,
  });
  if (!moved) await archiveDeployment(deployment.id);
}

async function recoverUnseenRuns(row: TaskRow, deadline: number): Promise<void> {
  if (row.anthropicDeploymentId === null) return;
  let found = false;
  const since =
    row.runAt === null
      ? new Date(Math.max(row.createdAt.getTime(), Date.now() - 24 * 60 * 60_000))
      : row.createdAt;
  for await (const upstream of listDeploymentSessions(row.anthropicDeploymentId, since)) {
    assertBeforeDeadline(deadline, 'Task run discovery reached its recovery deadline', {
      taskId: row.id,
    });
    const adopted = await adoptTaskRunSession(upstream);
    if (!adopted.adopted) continue;
    found = true;
    if (upstream.status === 'idle' || upstream.status === 'terminated')
      await completeTaskRun({
        anthropicSessionId: upstream.id,
        outcome: upstream.status,
        webhookEventId: `task-sweep:${upstream.id}`,
      });
  }
  // An overdue one-off with no run gets the "did not run" record, then its deployment goes.
  if (row.runAt !== null && !found) {
    await notifyMissedRun(row);
    await removeAndSync(row);
  }
}

async function notifyMissedRun(row: TaskRow): Promise<void> {
  const channels = notificationChannels(row.notification);
  if (!channels.email && !channels.inApp) return;
  const owner = (
    await db
      .select({ organizationId: workspace.organizationId })
      .from(workspace)
      .where(eq(workspace.id, row.workspaceId))
      .limit(1)
  ).at(0);
  if (!owner) return;
  await notify('task.failed', {
    organizationId: owner.organizationId,
    recipientUserIds: [row.createdByUserId],
    channels: { inApp: channels.inApp, email: channels.email ? 'force' : 'off' },
    idempotencyKey: `task-missed:${row.id}`,
    data: {
      title: 'Scheduled task did not run',
      body: `The scheduled time for ${row.title} passed without a run. Create a new schedule to try again.`,
    },
  });
}
