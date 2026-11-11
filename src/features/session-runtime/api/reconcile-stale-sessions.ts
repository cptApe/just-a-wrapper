import 'server-only';
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';
import { getAnthropicClient } from '@/features/agents';
import {
  awaitingProviderArchive,
  recordSessionProbe,
} from '@/features/sessions/api/session-transitions';
import { syncSessionStatus } from '@/features/sessions/api/sync-session-status';
import { STALE_SESSION_SECONDS } from '@/features/sessions/constants';
import { statusForEvent } from '@/features/sessions/lib/status-for-event';
import { recoverRows, settleRecoveryOperations } from '@/lib/recover-rows';
import { sweepDeadline } from '@/lib/sweep-deadline';
import { type ReconcileScope, reconcileSessionCreation } from './reconcile-session-creation';
import {
  archiveHiddenSession,
  readProviderSession,
  recoverSessionClaim,
} from './recover-session-claim';

// Probe nonterminal sessions and recover expired claims even without an attached relay.
// Probe timestamps rotate the batch without creating unread activity.

/** Upper bound on upstream lookups per sweep; older rows first, so a backlog
    drains across successive sweeps. */
const SWEEP_BATCH = 25;
/** Explicit per-request timeout for the upstream lookups — the SDK default is
    10 minutes, which would let one hung request stall the whole sweep pass. */
const UPSTREAM_LIST_TIMEOUT_MS = 30_000;
/** Sidebar reads can arrive in bursts during navigation. One successful check
    remains fresh for one relay-heartbeat interval instead of hitting upstream
    once per request. */
const READ_RECONCILE_COOLDOWN_MS = 25_000;
/** Keep a successful per-session probe reusable briefly. This prevents rapid
    chat creates from repeatedly probing a healthy long-running session. */
const SESSION_PROBE_COOLDOWN_MS = 20_000;

type Probe =
  | { phase: 'in_flight'; promise: Promise<void> }
  | { phase: 'fresh'; promise: Promise<void>; completedAt: number };
const recentReadReconciles = new Map<string, Probe>();
const recentSessionProbes = new Map<string, Probe>();

/** Dispatches the pending tool calls of a session that stopped on requires_action. The tools
    feature owns it and sits above the runtime, so every caller passes it in. */
export type DispatchPendingToolCalls = (anthropicSessionId: string) => Promise<void>;

// Reconcile stale status before chat-count and sidebar reads trust it. Request paths see only the
// caller's workspace; the recovery sweep covers every workspace.
export async function reconcileWorkspaceSessions(input: {
  workspaceId: string;
  rateLimit?: boolean;
  dispatchPendingToolCalls: DispatchPendingToolCalls;
}): Promise<void> {
  const scope = { workspaceId: input.workspaceId };
  if (!input.rateLimit) return runReconcile(scope, input.dispatchPendingToolCalls);
  const previous = recentReadReconciles.get(input.workspaceId);
  if (
    previous &&
    (previous.phase === 'in_flight' ||
      Date.now() - previous.completedAt < READ_RECONCILE_COOLDOWN_MS)
  ) {
    await previous.promise;
    return;
  }
  const promise = runReconcile(scope, input.dispatchPendingToolCalls);
  recentReadReconciles.set(input.workspaceId, { phase: 'in_flight', promise });
  try {
    await promise;
    recentReadReconciles.set(input.workspaceId, {
      phase: 'fresh',
      promise,
      completedAt: Date.now(),
    });
  } catch (error) {
    if (recentReadReconciles.get(input.workspaceId)?.promise === promise) {
      recentReadReconciles.delete(input.workspaceId);
    }
    throw error;
  }
}

/** The recovery sweep's pass over every workspace; user requests never run it. */
export function reconcileAllSessions(
  dispatchPendingToolCalls: DispatchPendingToolCalls,
): Promise<void> {
  return runReconcile('all-workspaces', dispatchPendingToolCalls);
}

async function runReconcile(
  scope: ReconcileScope,
  dispatchPendingToolCalls: DispatchPendingToolCalls,
): Promise<void> {
  await settleRecoveryOperations([
    reconcileSessionCreation(scope),
    reconcileSessionRows(scope, dispatchPendingToolCalls),
  ]);
}

async function reconcileSessionRows(
  scope: ReconcileScope,
  dispatchPendingToolCalls: DispatchPendingToolCalls,
): Promise<void> {
  pruneExpiredSessionProbes();
  const client = getAnthropicClient();
  if (!client) return;

  const stale = await db
    .select()
    .from(sessionTable)
    .where(
      and(
        or(
          awaitingProviderArchive,
          inArray(sessionTable.status, [
            'running',
            'rescheduling',
            'requires_input',
            'idle',
            'opening',
            'resuming',
            'pausing',
            'paused_no_credits',
            'awaiting_opening',
          ]),
        ),
        sql`(${sessionTable.status} not in ('awaiting_opening', 'paused_no_credits') or ${sessionTable.statusChangedAt} > now() - interval '1 day')`,
        sql`(${sessionTable.status} <> 'idle' or ${sessionTable.lastEventAt} > now() - interval '1 day')`,
        isNotNull(sessionTable.anthropicSessionId),
        scope === 'all-workspaces' ? undefined : eq(sessionTable.workspaceId, scope.workspaceId),
        sql`(${sessionTable.lastStatusProbeAt} is null or ${sessionTable.lastStatusProbeAt} < now() - make_interval(secs => ${STALE_SESSION_SECONDS}))`,
        sql`case when ${sessionTable.status} in ('opening', 'resuming', 'pausing') then ${sessionTable.statusChangedAt} < now() - interval '2 minutes' else coalesce(${sessionTable.lastEventAt}, ${sessionTable.createdAt}) < now() - make_interval(secs => ${STALE_SESSION_SECONDS}) end`,
      ),
    )
    .orderBy(
      sql`case when ${sessionTable.status} in ('opening', 'resuming', 'pausing') then 0 when ${sessionTable.status} in ('running', 'rescheduling', 'requires_input') then 1 else 2 end`,
      sql`${sessionTable.lastStatusProbeAt} asc nulls first`,
      sql`${sessionTable.lastEventAt} asc nulls first`,
    )
    .limit(SWEEP_BATCH);

  await recoverRows(
    stale,
    async (row) => {
      // The isNotNull guard above makes this a type refinement, not a filter.
      if (!row.anthropicSessionId) return;
      if (!(await recordSessionProbe(row.id, row.stateVersion))) return;
      if (row.hiddenAt) {
        await archiveHiddenSession(client, row);
        return;
      }
      if (
        row.status === 'pausing' ||
        row.status === 'paused_no_credits' ||
        row.status === 'opening' ||
        row.status === 'resuming' ||
        row.status === 'awaiting_opening'
      ) {
        await recoverSessionClaim(client, row);
        return;
      }
      await reconcileOneSingleFlight(client, row.anthropicSessionId, dispatchPendingToolCalls);
    },
    { deadline: sweepDeadline() },
  );
}

function pruneExpiredSessionProbes(): void {
  const now = Date.now();
  for (const [workspaceId, entry] of recentReadReconciles) {
    if (entry.phase === 'fresh' && now - entry.completedAt >= READ_RECONCILE_COOLDOWN_MS)
      recentReadReconciles.delete(workspaceId);
  }
  for (const [sessionId, probe] of recentSessionProbes) {
    if (probe.phase === 'fresh' && now - probe.completedAt >= SESSION_PROBE_COOLDOWN_MS) {
      recentSessionProbes.delete(sessionId);
    }
  }
}

async function reconcileOneSingleFlight(
  client: NonNullable<ReturnType<typeof getAnthropicClient>>,
  anthropicSessionId: string,
  dispatchPendingToolCalls: DispatchPendingToolCalls,
): Promise<void> {
  const previous = recentSessionProbes.get(anthropicSessionId);
  if (
    previous &&
    (previous.phase === 'in_flight' ||
      Date.now() - previous.completedAt < SESSION_PROBE_COOLDOWN_MS)
  ) {
    await previous.promise;
    return;
  }
  const promise = reconcileOne(client, anthropicSessionId, dispatchPendingToolCalls);
  const probe: Probe = { phase: 'in_flight', promise };
  recentSessionProbes.set(anthropicSessionId, probe);
  try {
    await promise;
    if (recentSessionProbes.get(anthropicSessionId) === probe)
      recentSessionProbes.set(anthropicSessionId, {
        phase: 'fresh',
        promise,
        completedAt: Date.now(),
      });
  } catch (error) {
    if (recentSessionProbes.get(anthropicSessionId) === probe) {
      recentSessionProbes.delete(anthropicSessionId);
    }
    throw error;
  }
}

async function reconcileOne(
  client: NonNullable<ReturnType<typeof getAnthropicClient>>,
  anthropicSessionId: string,
  dispatchPendingToolCalls: DispatchPendingToolCalls,
): Promise<void> {
  const page = await readProviderSession(anthropicSessionId, () =>
    client.beta.sessions.events.list(
      anthropicSessionId,
      {
        order: 'desc',
        types: [
          'session.status_running',
          'session.status_rescheduled',
          'session.status_idle',
          'session.status_terminated',
        ],
        limit: 1,
      },
      { timeout: UPSTREAM_LIST_TIMEOUT_MS },
    ),
  );
  if (!page) return;
  for await (const event of page) {
    const status = statusForEvent(event);
    if (status) {
      // The reconcile keys nudges by the provider event id, so a heal of a turn the
      // relay/webhook already announced deduplicates by notification occurrence key.
      const current = await syncSessionStatus({
        kind: 'reconcile',
        anthropicSessionId,
        allowFromPause: status === 'terminated',
      });
      if (current?.stopReason === 'requires_action')
        await dispatchPendingToolCalls(anthropicSessionId);
      return;
    }
    break;
  }
}
