import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { session } from '@/db/schema';
import { assertCanSpend } from '@/features/billing/api/spend-gate';
import { assertSessionActor } from '@/features/sessions/api/assert-session-actor';
import type { SentMessageEcho } from '@/features/sessions/api/send-message';
import type { SessionWriteGrant } from '@/features/sessions/api/session-access';
import {
  claimSessionSend,
  finishSessionSend,
  recoverSessionSend,
  type SendLease,
} from '@/features/sessions/api/session-send-transitions';
import { scheduleSyncSessionStatus } from '@/features/sessions/api/sync-session-status';
import { isSessionSendRefused } from '@/features/sessions/lib/session-send-refusal';
import { AppError } from '@/lib/errors';
import { shipLog } from '@/lib/logger';
import { scheduleSessionTitleGeneration } from './generate-session-title';
import type { DispatchPendingToolCalls } from './reconcile-stale-sessions';
import {
  claimOpeningTurn,
  sendOpeningMessage,
  sendWithGateRefusal,
  withChatCapacity,
} from './start-turn';

type SendInput = {
  sendId?: string;
  sessionId: string;
  text: string;
  opening?: boolean;
  caller: SessionWriteGrant;
  dispatchPendingToolCalls: DispatchPendingToolCalls;
};

export async function sendSessionMessage(input: SendInput): Promise<SentMessageEcho | null> {
  await assertSessionActor(input.sessionId, input.caller.userId);
  if (!input.sendId) return postSessionMessage(input, undefined);
  const identity = {
    id: input.sendId,
    sessionId: input.sessionId,
    userId: input.caller.userId,
    text: input.text,
  };
  let claim = await claimSessionSend(identity);
  if (claim.kind === 'unconfirmed') {
    const recovered = await recoverSessionSend(input.sendId, input.caller.anthropicSessionId);
    if (recovered.kind === 'delivered') return recovered.echo;
    if (recovered.kind === 'retry') claim = await claimSessionSend(identity);
  }
  if (claim.kind === 'delivered') return claim.echo;
  if (claim.kind === 'unconfirmed') throw unconfirmedSend(input);
  const { lease } = claim;
  let echo: SentMessageEcho | null;
  try {
    echo = await postSessionMessage(input, lease);
  } catch (error) {
    const status = isSessionSendRefused(error) ? 'error' : 'unconfirmed';
    if (!(await finishSessionSend(lease, { status }))) logLostLease(lease, status);
    // Preserve provider errors so the route can show its outage message.
    throw error;
  }
  const outcome = echo
    ? { status: 'delivered' as const, echo }
    : { status: 'unconfirmed' as const };
  // A lost lease leaves the row to recovery, which confirms this echo from the provider log.
  if (!(await finishSessionSend(lease, outcome))) logLostLease(lease, outcome.status);
  if (!echo) throw unconfirmedSend(input);
  return echo;
}

async function postSessionMessage(input: SendInput, lease: SendLease | undefined) {
  const { sessionId, text } = input;
  const { userId, createdByUserId, anthropicSessionId, workspaceId, organizationId } = input.caller;
  // Only a message about to be posted can start or extend a paid turn. A retry of a send the
  // provider already accepted returns before this, so it is never refused for credits.
  await assertCanSpend({ entry: 'send', workspaceId, userId });
  const capacity = { workspaceId, dispatchPendingToolCalls: input.dispatchPendingToolCalls };
  const row = (
    await db
      .select({ status: session.status, kind: session.kind })
      .from(session)
      .where(and(eq(session.id, sessionId), eq(session.workspaceId, workspaceId)))
      .limit(1)
  ).at(0);

  let echo: SentMessageEcho | null;
  if (input.opening === true || row?.status === 'awaiting_opening') {
    const claim = await claimOpeningTurn({ sessionId, workspaceId, createdByUserId }, capacity);
    echo = await sendOpeningMessage({
      sessionId,
      anthropicSessionId,
      workspaceId,
      organizationId,
      userId,
      text,
      origin: 'user',
      lease,
      claim,
    });
    scheduleSessionTitleGeneration({
      anthropicSessionId,
      workspaceId,
      organizationId,
      userId,
      message: text,
    });
  } else {
    // A send to an idle chat starts a new turn. The check holds no slot: the provider reports
    // the turn as running.
    if (row?.status === 'idle' && row.kind === 'chat')
      await withChatCapacity(capacity, async () => undefined);
    echo = await sendWithGateRefusal({
      sessionId: anthropicSessionId,
      workspaceId,
      text,
      origin: 'user',
      lease,
    });
  }

  // Reconcile the current provider state after sending; the local pause remains authoritative.
  scheduleSyncSessionStatus({ kind: 'reconcile', anthropicSessionId, allowFromPause: false });
  return echo;
}

function unconfirmedSend(input: SendInput) {
  return new AppError('SESSION_BUSY', 'Message delivery is still being confirmed', {
    reason: 'send-unconfirmed',
    sendId: input.sendId,
    sessionId: input.sessionId,
  });
}

function logLostLease(lease: SendLease, outcome: string) {
  shipLog({
    level: 'warn',
    msg: 'session.send.lease_lost',
    feature: 'sessions',
    op: 'finish-session-send',
    send_id: lease.sendId,
    outcome,
  });
}
