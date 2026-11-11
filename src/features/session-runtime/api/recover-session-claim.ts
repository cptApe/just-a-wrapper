import 'server-only';
import { APIError } from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { session } from '@/db/schema';
import type { getAnthropicClient } from '@/features/agents';
import { loadBillableSession } from '@/features/billing/api/load-billable-session';
import { notifySessionPaused } from '@/features/billing/api/pause-session-on-exhaustion';
import { AUTO_RESUME_CUTOFF_MS } from '@/features/billing/api/sync-session-budgets';
import {
  markSessionArchived,
  renewSessionPause,
  transitionSession,
} from '@/features/sessions/api/session-transitions';
import { syncSessionStatus } from '@/features/sessions/api/sync-session-status';
import { SESSION_SEND_OPTIONS } from '@/features/sessions/constants';
import { AppError } from '@/lib/errors';

type Client = NonNullable<ReturnType<typeof getAnthropicClient>>;
type Session = typeof session.$inferSelect;

// Only a status read can prove the provider session is missing. Mutation rejections remain retryable.
export async function readProviderSession<T>(
  id: string,
  read: () => PromiseLike<T>,
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof APIError) || error.status !== 404) throw error;
    await syncSessionStatus({ kind: 'provider-missing', anthropicSessionId: id });
    return null;
  }
}

export async function recoverSessionClaim(client: Client, row: Session): Promise<void> {
  if (!row.anthropicSessionId) return;
  const id = row.anthropicSessionId;
  const renewed =
    row.status === 'pausing' && row.pausedReason
      ? await renewSessionPause(row.id, row.pausedReason)
      : null;
  if (row.status === 'pausing' && !renewed) return;
  const current = renewed ?? row;
  const expected = { status: current.status, version: current.stateVersion };
  const upstream = await readProviderSession(row.anthropicSessionId, () =>
    client.beta.sessions.retrieve(id, {}, { timeout: 30_000 }),
  );
  if (!upstream) return;
  if (upstream.status === 'terminated') {
    await transitionSession({
      executor: db,
      where: eq(session.id, row.id),
      to: 'terminated',
      expected,
      pause: null,
      activity: null,
    });
    return;
  }
  if (row.status === 'awaiting_opening') return;
  if (row.status === 'pausing' || row.status === 'paused_no_credits') {
    await recoverPause(client, current, upstream);
    return;
  }
  const events = await readProviderSession(row.anthropicSessionId, () =>
    client.beta.sessions.events.list(
      id,
      { order: 'desc', limit: 1, types: ['user.message'] },
      { timeout: 30_000 },
    ),
  );
  if (!events) return;
  const latest = events.data.at(0);
  const sent =
    upstream.status === 'running' ||
    upstream.status === 'rescheduling' ||
    (latest &&
      (row.status === 'opening' ||
        latest.processed_at == null ||
        Date.parse(latest.processed_at) >= row.statusChangedAt.getTime()));
  await transitionSession({
    executor: db,
    where: eq(session.id, row.id),
    to: sent ? 'running' : row.status === 'opening' ? 'awaiting_opening' : 'paused_no_credits',
    expected,
    activity: null,
    pause: row.pausedAt && row.pausedReason ? { at: row.pausedAt, reason: row.pausedReason } : null,
  });
}

async function recoverPause(
  client: Client,
  row: Session,
  upstream: Awaited<ReturnType<Client['beta']['sessions']['retrieve']>>,
): Promise<void> {
  if (!row.anthropicSessionId || !row.pausedAt || !row.pausedReason) return;
  if (upstream.status === 'running' || upstream.status === 'rescheduling') {
    const owned = (
      await db
        .select({ id: session.id })
        .from(session)
        .where(
          and(
            eq(session.id, row.id),
            eq(session.status, row.status),
            eq(session.stateVersion, row.stateVersion),
          ),
        )
        .limit(1)
    ).at(0);
    if (!owned) return;
    await client.beta.sessions.events.send(
      row.anthropicSessionId,
      { events: [{ type: 'user.interrupt' }] },
      SESSION_SEND_OPTIONS,
    );
  }
  if (row.status === 'pausing') {
    const moved = await transitionSession({
      executor: db,
      where: eq(session.id, row.id),
      to: 'paused_no_credits',
      expected: { status: row.status, version: row.stateVersion },
      activity: null,
      pause: { at: row.pausedAt, reason: row.pausedReason },
    });
    if (moved.length === 0) return;
  }
  if (row.status !== 'pausing' && Date.now() - row.pausedAt.getTime() > AUTO_RESUME_CUTOFF_MS)
    return;
  // A crash after finalization can precede notification insertion. The occurrence key makes retry safe.
  const target = await loadBillableSession(row.anthropicSessionId);
  if (target)
    await notifySessionPaused(target, target.creditBalance, row.pausedReason, row.pausedAt);
}

// A hidden row is terminal (session_hidden_check); archiving its provider session finishes it.
export async function archiveHiddenSession(client: Client, row: Session): Promise<void> {
  if (!row.anthropicSessionId) return;
  const id = row.anthropicSessionId;
  const upstream = await readProviderSession(id, () =>
    client.beta.sessions.retrieve(id, {}, { timeout: 30_000 }),
  );
  if (upstream && !upstream.archived_at) {
    if (upstream.status === 'running' || upstream.status === 'rescheduling') {
      await client.beta.sessions.events.send(
        id,
        { events: [{ type: 'user.interrupt' }] },
        SESSION_SEND_OPTIONS,
      );
      return;
    }
    await client.beta.sessions.archive(id);
  }
  if (!(await markSessionArchived(row.id, row.stateVersion)))
    throw new AppError('CONFLICT', 'Session changed before archive completion', {
      sessionId: row.id,
    });
}
