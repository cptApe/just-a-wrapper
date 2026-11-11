import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lt, lte, type SQL, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { session, sessionSend } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { AppError } from '@/lib/errors';
import { collectRecoveryFailures, DurableRecoveryError } from '@/lib/recover-rows';
import { sweepDeadline } from '@/lib/sweep-deadline';
import { readClientSendTag } from '../lib/client-send-tag';
import { textFromContent } from '../lib/event-content';
import { sessionSendMachine } from '../lib/session-send-machine';
import type { SentMessageEcho } from './send-message';

// Outlasts the slowest send: a budget refresh, two 30 second provider posts and a budget probe.
const SEND_LEASE_SECONDS = 180;
// The provider log can lag an ambiguous post; a miss is trusted only after this window.
const SEND_CONFIRMATION_SECONDS = 60;
export const SESSION_SEND_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** The sender's claim on one attempt. Only its holder may post or settle that attempt. */
export type SendLease = { sendId: string; token: string };

type SendIdentity = { id: string; sessionId: string; userId: string; text: string };
type Send = typeof sessionSend.$inferSelect;

const secondsFromNow = (seconds: number) => sql`now() + make_interval(secs => ${seconds})`;
const recoverable = lte(sessionSend.recoverAfter, sql`now()`);

export async function claimSessionSend(input: SendIdentity) {
  const { text, ...identity } = input;
  const contentHash = createHash('sha256').update(text).digest('hex');
  await pruneDeliveredSends();
  const token = randomUUID();
  const lease = { sendId: input.id, token };
  const leased = {
    status: 'sending' as const,
    attemptToken: token,
    recoverAfter: secondsFromNow(SEND_LEASE_SECONDS),
    updatedAt: sql`now()`,
  };
  const inserted = await db
    .insert(sessionSend)
    .values({ ...identity, contentHash, ...leased })
    .onConflictDoNothing({ target: sessionSend.id })
    .returning({ id: sessionSend.id });
  if (inserted.length) return { kind: 'claimed' as const, lease };
  const row = await loadSend(input.id);
  if (
    !row ||
    row.sessionId !== input.sessionId ||
    row.userId !== input.userId ||
    row.contentHash !== contentHash
  )
    throw new AppError('INVALID_BODY', 'Send identity does not match this message', {
      sendId: input.id,
      sessionId: input.sessionId,
    });
  const delivered = deliveredEcho(row);
  if (delivered) return { kind: 'delivered' as const, echo: delivered };
  // Only a refused attempt is safe to post again.
  const reclaimed = await moveSend(input.id, 'sending', leased);
  if (reclaimed) return { kind: 'claimed' as const, lease };
  await takeOverLapsedLeases(eq(sessionSend.id, input.id));
  return { kind: 'unconfirmed' as const };
}

/** Extends the lease right before a provider post. False means recovery owns the attempt now. */
export async function renewSessionSendLease(lease: SendLease): Promise<boolean> {
  const rows = await db
    .update(sessionSend)
    .set({ recoverAfter: secondsFromNow(SEND_LEASE_SECONDS), updatedAt: sql`now()` })
    .where(ownedBy(lease))
    .returning({ id: sessionSend.id });
  return rows.length > 0;
}

/** Settles the leased attempt. False means the lease lapsed and the new owner settles it. */
export async function finishSessionSend(
  lease: SendLease,
  outcome: { status: 'delivered'; echo: SentMessageEcho } | { status: 'error' | 'unconfirmed' },
): Promise<boolean> {
  const rows = await db
    .update(sessionSend)
    .set(settled(outcome, lease.token))
    .where(
      and(
        ownedBy(lease),
        inArray(sessionSend.status, sessionSendMachine.sourcesOf(outcome.status)),
      ),
    )
    .returning({ id: sessionSend.id });
  return rows.length > 0;
}

/** Resolves an unconfirmed attempt from the provider log: delivered, safe to retry, or still open. */
export async function recoverSessionSend(id: string, anthropicSessionId: string) {
  const row = await loadSend(id);
  if (!row) throw new AppError('INVALID_BODY', 'Send identity is missing', { sendId: id });
  const delivered = deliveredEcho(row);
  if (delivered) return { kind: 'delivered' as const, echo: delivered };
  if (row.status === 'error') return { kind: 'retry' as const };
  if (row.status !== 'unconfirmed' || !row.attemptToken) return { kind: 'unconfirmed' as const };
  const attempt = and(
    eq(sessionSend.id, id),
    eq(sessionSend.status, 'unconfirmed'),
    eq(sessionSend.attemptToken, row.attemptToken),
  );
  const echo = await findDeliveredEcho(id, anthropicSessionId);
  if (echo) {
    await db
      .update(sessionSend)
      .set(settled({ status: 'delivered', echo }, row.attemptToken))
      .where(and(attempt, inArray(sessionSend.status, sessionSendMachine.sourcesOf('delivered'))))
      .returning({ id: sessionSend.id });
    return { kind: 'delivered' as const, echo };
  }
  const missed = await db
    .update(sessionSend)
    .set(settled({ status: 'error' }, row.attemptToken))
    .where(
      and(attempt, recoverable, inArray(sessionSend.status, sessionSendMachine.sourcesOf('error'))),
    )
    .returning({ id: sessionSend.id });
  return { kind: missed.length ? ('retry' as const) : ('unconfirmed' as const) };
}

// Sidebar maintenance resolves abandoned attempts even when the original browser never retries.
export async function sweepSessionSends() {
  await takeOverLapsedLeases(undefined);
  const stale = await db
    .select({
      id: sessionSend.id,
      attemptToken: sessionSend.attemptToken,
      anthropicSessionId: session.anthropicSessionId,
    })
    .from(sessionSend)
    .innerJoin(session, eq(session.id, sessionSend.sessionId))
    .where(and(eq(sessionSend.status, 'unconfirmed'), recoverable))
    .orderBy(asc(sessionSend.recoverAfter))
    .limit(25);
  const failures = await collectRecoveryFailures(
    stale,
    async (row) => {
      if (row.anthropicSessionId) await recoverSessionSend(row.id, row.anthropicSessionId);
      // No provider session means nothing was posted.
      else if (row.attemptToken)
        await moveSend(row.id, 'error', settled({ status: 'error' }, row.attemptToken), [
          eq(sessionSend.attemptToken, row.attemptToken),
        ]);
    },
    { deadline: sweepDeadline() },
  );
  await pruneDeliveredSends();
  if (failures.length > 0) throw new DurableRecoveryError(failures);
}

// A lapsed lease proves its sender stopped posting. The attempt becomes recoverable at once.
async function takeOverLapsedLeases(where: SQL | undefined) {
  await db
    .update(sessionSend)
    .set({ status: 'unconfirmed', recoverAfter: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        where,
        eq(sessionSend.status, 'sending'),
        recoverable,
        inArray(sessionSend.status, sessionSendMachine.sourcesOf('unconfirmed')),
      ),
    );
}

function ownedBy(lease: SendLease) {
  return and(
    eq(sessionSend.id, lease.sendId),
    eq(sessionSend.status, 'sending'),
    eq(sessionSend.attemptToken, lease.token),
  );
}

// An unconfirmed attempt keeps its token so recovery can tell it from a later attempt.
function settled(
  outcome: { status: 'delivered'; echo: SentMessageEcho } | { status: 'error' | 'unconfirmed' },
  token: string,
) {
  const open = outcome.status === 'unconfirmed';
  return {
    status: outcome.status,
    eventId: outcome.status === 'delivered' ? outcome.echo.eventId : null,
    processedAt: outcome.status === 'delivered' ? outcome.echo.processedAt : null,
    attemptToken: open ? token : null,
    recoverAfter: open ? secondsFromNow(SEND_CONFIRMATION_SECONDS) : null,
    updatedAt: sql`now()`,
  };
}

async function moveSend(
  id: string,
  to: Send['status'],
  values: PgUpdateSetSource<typeof sessionSend>,
  guards: SQL[] = [],
): Promise<boolean> {
  const rows = await db
    .update(sessionSend)
    .set(values)
    .where(
      and(
        eq(sessionSend.id, id),
        inArray(sessionSend.status, sessionSendMachine.sourcesOf(to)),
        ...guards,
      ),
    )
    .returning({ id: sessionSend.id });
  return rows.length > 0;
}

async function findDeliveredEcho(
  id: string,
  anthropicSessionId: string,
): Promise<SentMessageEcho | null> {
  const client = requireAnthropicClient();
  for await (const event of client.beta.sessions.events.list(anthropicSessionId, {
    types: ['user.message'],
    order: 'desc',
    limit: 100,
  })) {
    if (event.type !== 'user.message') continue;
    if (readClientSendTag(textFromContent(event.content)).sendId === id)
      return { eventId: event.id, processedAt: event.processed_at ?? null };
  }
  return null;
}

async function loadSend(id: string): Promise<Send | undefined> {
  return (await db.select().from(sessionSend).where(eq(sessionSend.id, id))).at(0);
}

function deliveredEcho(row: Send): SentMessageEcho | null {
  return row.status === 'delivered' && row.eventId
    ? { eventId: row.eventId, processedAt: row.processedAt }
    : null;
}

async function pruneDeliveredSends() {
  await db
    .delete(sessionSend)
    .where(
      and(
        eq(sessionSend.status, 'delivered'),
        lt(sessionSend.updatedAt, new Date(Date.now() - SESSION_SEND_RETENTION_MS)),
      ),
    );
}
