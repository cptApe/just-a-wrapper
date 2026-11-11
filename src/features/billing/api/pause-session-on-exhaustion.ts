import { SESSION_SEND_OPTIONS } from '@/features/sessions/constants';
// The durable pause blocks new work even when interrupt or notification delivery fails.

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { processedWebhookEvent, session as sessionTable } from '@/db/schema';
import { notify } from '@/features/notifications/api/notify';
import { publishSessionEvent, publishWorkspaceEvent } from '@/features/realtime/api/publish';
import {
  claimSessionPause,
  renewSessionPause,
  transitionSession,
} from '@/features/sessions/api/session-transitions';
import { AppError } from '@/lib/errors';
import { shipLog } from '@/lib/logger';
import { captureException } from '@/lib/observability';
import 'server-only';
import { requireAnthropicClient } from '@/features/agents/api/anthropic-client';
import { creditPauseNotice } from '../lib/credit-pause-notice';
import {
  type BillableSession,
  loadBillableSession,
  skipUnknownSession,
} from './load-billable-session';

type CreditPause =
  | { reason: 'credits' | 'member_limit' }
  | { reason: 'budget'; webhookEventId: string };

// The spend gate's refusal reason picks the pause reason and its notice.
export async function pauseSessionForInsufficientCredits(
  anthropicSessionId: string,
  reason: 'credits' | 'member_limit' = 'credits',
): Promise<boolean> {
  const target = await loadBillableSession(anthropicSessionId);
  if (!target || target.platformPaid) return false;
  return pauseSessionOnExhaustion(target, target.creditBalance, { reason });
}

export async function pauseSessionForBudgetReached(input: {
  anthropicSessionId: string;
  webhookEventId: string;
}): Promise<boolean> {
  const target = await loadBillableSession(input.anthropicSessionId);
  if (!target) {
    skipUnknownSession('budget_reached', input.anthropicSessionId);
    return false;
  }
  const paused = await pauseSessionOnExhaustion(target, target.creditBalance, {
    reason: 'budget',
    webhookEventId: input.webhookEventId,
  });
  shipLog({
    msg: 'billing.session_budget_reached',
    feature: 'billing',
    op: 'pause-on-budget-reached',
    session_id: input.anthropicSessionId,
    webhook_event_id: input.webhookEventId,
    paused,
  });
  return paused;
}

// Only the current pause claimant interrupts; expired claims can be recovered.
// The pause timestamp keys notification retries, and private events use the creator channel.
export async function pauseSessionOnExhaustion(
  target: BillableSession,
  balance: number,
  pause: CreditPause,
): Promise<boolean> {
  const { reason } = pause;
  const claimed = await claimCreditPause(target, pause);
  let pausedRow: typeof sessionTable.$inferSelect | null | undefined =
    claimed.at(0) ??
    (
      await db
        .select()
        .from(sessionTable)
        .where(
          and(
            eq(sessionTable.id, target.rowId),
            eq(sessionTable.status, 'paused_no_credits'),
            eq(sessionTable.pausedReason, reason),
          ),
        )
        .limit(1)
    ).at(0);
  if (!pausedRow) pausedRow = await renewSessionPause(target.rowId, reason);
  if (!pausedRow) return false;
  if (!pausedRow.pausedAt)
    throw new AppError('CONFLICT', 'Paused session has no pause timestamp', {
      sessionId: target.rowId,
    });

  if (pausedRow.status === 'pausing') {
    shipLog({
      msg: 'billing.session_paused',
      feature: 'billing',
      op: 'pause-on-exhaustion',
      session_id: target.anthropicSessionId,
      balance,
    });

    await publishCreditPause(target, balance, reason);
    try {
      await postInterruptToAnthropic(target.anthropicSessionId);
    } catch (error) {
      // Settlement must reach auto-top-up; the sweep retries this durable pause claim.
      captureException(error, {
        feature: 'billing',
        op: 'pause-interrupt',
        sessionId: target.rowId,
      });
      return claimed.length > 0;
    }
    const finalized = await transitionSession({
      executor: db,
      where: eq(sessionTable.id, target.rowId),
      to: 'paused_no_credits',
      expected: { status: 'pausing', version: pausedRow.stateVersion },
      activity: null,
      pause: { reason, at: pausedRow.pausedAt },
    });
    if (finalized.length === 0) return false;
  }

  await notifySessionPaused(target, balance, reason, pausedRow.pausedAt);

  return claimed.length > 0;
}

export async function notifySessionPaused(
  target: BillableSession,
  balance: number,
  reason: CreditPause['reason'],
  pausedAt: Date,
): Promise<void> {
  await notify('credits.paused', {
    organizationId: target.organizationId,
    idempotencyKey: `${reason}-paused:${target.rowId}:${pausedAt.toISOString()}`,
    data: { sessionId: target.anthropicSessionId, balance, ...creditPauseNotice(reason) },
  }).catch((error: unknown) =>
    captureException(error, { feature: 'billing', op: 'pause-notify', sessionId: target.rowId }),
  );
}

async function postInterruptToAnthropic(anthropicSessionId: string): Promise<void> {
  const client = requireAnthropicClient();
  await client.beta.sessions.events.send(
    anthropicSessionId,
    {
      events: [{ type: 'user.interrupt' }],
    },
    SESSION_SEND_OPTIONS,
  );
}

async function claimCreditPause(target: BillableSession, pause: CreditPause) {
  const { reason } = pause;
  return db.transaction(async (tx) => {
    if (pause.reason === 'budget') {
      const eventClaim = await tx
        .insert(processedWebhookEvent)
        .values({
          provider: 'anthropic',
          eventId: pause.webhookEventId,
          eventType: 'session.budget_reached',
          payload: { sessionId: target.anthropicSessionId },
        })
        .onConflictDoNothing({
          target: [processedWebhookEvent.provider, processedWebhookEvent.eventId],
        })
        .returning({ eventId: processedWebhookEvent.eventId });
      if (eventClaim.length === 0) return [];
    }
    return claimSessionPause(tx, target.rowId, reason);
  });
}

async function publishCreditPause(
  target: BillableSession,
  balance: number,
  reason: CreditPause['reason'],
) {
  // Attempt both balance and status broadcasts even if one channel fails.
  const results = await Promise.allSettled([
    publishSessionEvent(
      {
        type: 'session_status',
        sessionId: target.rowId,
        status: 'paused_no_credits',
        pausedReason: reason,
      },
      {
        organizationId: target.organizationId,
        session: { visibility: target.visibility, createdByUserId: target.createdByUserId },
      },
    ),
    publishWorkspaceEvent(target.organizationId, { type: 'credits', balance }),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      captureException(result.reason, { feature: 'billing', op: 'pause-publish' });
    }
  }
}
