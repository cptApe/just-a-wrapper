import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable, workspace } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
// Direct module imports (not the notifications barrel) — same graph discipline
// as the billing/webhook call sites.
import { notifyTaskEvent } from '@/features/notifications/api/notify-task-events';
import { publishSessionEvent } from '@/features/realtime/api/publish';
import { AppError } from '@/lib/errors';
import { isPauseStatus, sessionMachine } from '../lib/session-machine';
import { type SyncableSessionStatus, statusForEvent } from '../lib/status-for-event';
import { runAfterResponse } from './create-background-work';
import { transitionSession } from './session-transitions';

// Reconcile from the provider log, retaining local pauses and terminal states.
// Repeated notifications use the provider event ID to recover failed delivery without duplicates.
export type SyncSessionStatusInput =
  // Reads the provider's latest status. Only terminal evidence may override a local pause.
  | { kind: 'reconcile'; anthropicSessionId: string; allowFromPause: boolean }
  // A provider 404 proves the session is gone. No work completed, so it terminates without nudges.
  | { kind: 'provider-missing'; anthropicSessionId: string };

export async function syncSessionStatus(input: SyncSessionStatusInput): Promise<{
  status: SyncableSessionStatus;
  stopReason: typeof sessionTable.$inferSelect.stopReason;
} | null> {
  const before = (
    await db
      .select()
      .from(sessionTable)
      .where(eq(sessionTable.anthropicSessionId, input.anthropicSessionId))
      .limit(1)
  ).at(0);
  if (!before) return null;
  if (isPauseStatus(before.status) && input.kind === 'reconcile' && !input.allowFromPause)
    return null;
  const observed =
    input.kind === 'provider-missing'
      ? PROVIDER_MISSING
      : await latestSessionStatus(input.anthropicSessionId).catch((cause: unknown) => {
          throw new AppError(
            'EXTERNAL_API_FAILED',
            'Failed to read the session stop reason',
            { anthropicSessionId: input.anthropicSessionId },
            { cause },
          );
        });
  if (!observed || (before.status === 'resuming' && observed.status !== 'terminated')) return null;
  if (!sessionMachine.can(before.status, observed.status)) return null;
  const rows = await transitionSession({
    activity: observed.activity,
    executor: db,
    where: eq(sessionTable.id, before.id),
    to: observed.status,
    expected: { status: before.status, version: before.stateVersion },
    pause: null,
  });
  const outcome = { status: observed.status, stopReason: observed.activity?.stopReason ?? null };
  let row = rows.at(0);
  if (!row) {
    const current = (
      await db.select().from(sessionTable).where(eq(sessionTable.id, before.id)).limit(1)
    ).at(0);
    if (
      current &&
      current.stateVersion !== before.stateVersion &&
      (current.status !== observed.status ||
        (observed.activity !== null &&
          (!current.lastEventAt || current.lastEventAt < observed.activity.at)))
    ) {
      throw new AppError('CONFLICT', 'Session changed during status reconciliation', {
        sessionId: before.id,
      });
    }
    if (!current) return null;
    if (
      observed.activity !== null &&
      current.lastEventAt?.getTime() !== observed.activity.at.getTime()
    )
      return { status: observed.status, stopReason: current.stopReason };

    row = current;
  }

  const ws = (
    await db
      .select({ organizationId: workspace.organizationId })
      .from(workspace)
      .where(eq(workspace.id, row.workspaceId))
      .limit(1)
  ).at(0);
  if (!ws) return outcome;
  // Publish by local UUID on the creator channel for private tasks; the guarded transition row
  // supplies visibility without another session read.
  if (rows.length > 0)
    await publishSessionEvent(
      { type: 'session_status', sessionId: row.id, status: observed.status },
      {
        organizationId: ws.organizationId,
        session: { visibility: row.visibility, createdByUserId: row.createdByUserId },
      },
    );
  // Replays retry notification delivery under the same occurrence key without republishing status.
  if (observed.nudgeEventId !== null)
    await notifyStatusTransition(input.anthropicSessionId, observed.status, observed.nudgeEventId);
  return outcome;
}

// Snapshot request context before scheduling: background status updates must retain attribution
// after the response.
export function scheduleSyncSessionStatus(input: SyncSessionStatusInput): void {
  runAfterResponse(
    'sync-session-status',
    { sessionId: input.anthropicSessionId, kind: input.kind },
    async () => {
      await syncSessionStatus(input);
    },
  );
}

type SessionObservation = {
  status: SyncableSessionStatus;
  activity: { at: Date; stopReason: typeof sessionTable.$inferSelect.stopReason } | null;
  // The provider event ID keys task nudges. It is null when the observation must not nudge.
  nudgeEventId: string | null;
};

const PROVIDER_MISSING: SessionObservation = {
  status: 'terminated',
  activity: null,
  nudgeEventId: null,
};

// Idle webhooks omit stop_reason. The latest idle event distinguishes requires_input and supplies
// its ID for notification deduplication. Failed reads throw so delivery can retry.
async function latestSessionStatus(anthropicSessionId: string): Promise<SessionObservation | null> {
  const client = requireAnthropicClient();
  const events = await client.beta.sessions.events.list(
    anthropicSessionId,
    {
      order: 'desc',
      limit: 20,
      types: [
        'session.status_idle',
        'session.status_running',
        'session.status_rescheduled',
        'session.status_terminated',
        'user.message',
        'user.interrupt',
      ],
    },
    { timeout: 30_000 },
  );
  let observed: SessionObservation | null = null;
  for await (const event of events) {
    if (!observed) {
      // A newer command is waiting to be processed; its preceding idle is not the current turn.
      if (event.type === 'user.message' || event.type === 'user.interrupt') return null;
      const status = statusForEvent(event);
      if (!status) continue;
      if (!event.processed_at)
        throw new AppError('EXTERNAL_API_FAILED', 'Status event has no processing timestamp', {
          eventId: event.id,
        });
      const stopReason = event.type === 'session.status_idle' ? event.stop_reason.type : null;
      observed = {
        status,
        activity: { at: new Date(event.processed_at), stopReason },
        nudgeEventId:
          stopReason !== 'budget_reached' && stopReason !== 'retries_exhausted' ? event.id : null,
      };
      if (stopReason !== 'end_turn') return observed;
    } else {
      if (event.type === 'user.interrupt')
        return {
          ...observed,
          nudgeEventId: null,
          activity: observed.activity ? { ...observed.activity, stopReason: 'interrupted' } : null,
        };
      if (event.type === 'user.message' || event.type === 'session.status_running') return observed;
    }
  }
  return observed;
}

async function notifyStatusTransition(
  anthropicSessionId: string,
  status: SyncableSessionStatus,
  eventId: string,
): Promise<void> {
  if (status === 'idle') {
    // Each opted-in task event sends one email while its recipient is away.
    await notifyTaskEvent({ anthropicSessionId, event: 'task.completed', eventId });
  } else if (status === 'terminated') {
    await notifyTaskEvent({ anthropicSessionId, event: 'task.failed', eventId });
  }
}
