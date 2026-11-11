import 'server-only';
import { randomUUID } from 'node:crypto';
import { NotFoundError } from '@anthropic-ai/sdk';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents/api/anthropic-client';
import { accrueSessionEnd } from './accrue-session-end';
import { accrueSessionUsageEvent, type UsageEvent } from './accrue-session-usage-event';
import { loadBillableSession } from './load-billable-session';

const REPLAY_CLOCK_SKEW_MS = 60_000;

// Persist partial progress so a long history resumes after the last completed event.
export async function reconcileSessionUsage(
  anthropicSessionId: string,
  deadline: number,
): Promise<void> {
  const target = await loadBillableSession(anthropicSessionId);
  if (!target) return;
  const startedAt = new Date();
  const [row] = await db
    .update(session)
    .set({ usageReconcileAttemptedAt: startedAt })
    .where(eq(session.id, target.rowId))
    .returning({ cursor: session.usageReconciledAt });
  if (!row) return;
  let cursor = row.cursor;
  let latest: Extract<UsageEvent, { type: 'session.usage' }> | null = null;
  try {
    const events = await requireAnthropicClient().beta.sessions.events.list(
      anthropicSessionId,
      {
        order: 'asc',
        types: ['span.model_request_end', 'session.usage'],
        ...(cursor === null
          ? {}
          : { 'created_at[gt]': new Date(cursor.getTime() - REPLAY_CLOCK_SKEW_MS).toISOString() }),
      },
      { timeout: 30_000, maxRetries: 0 },
    );
    for await (const event of events) {
      if (event.type === 'span.model_request_end')
        await accrueSessionUsageEvent(anthropicSessionId, event);
      if (event.type === 'session.usage') latest = event;
      if (event.processed_at != null) cursor = new Date(event.processed_at);
      if (Date.now() >= deadline) {
        if (latest) await accrueSessionUsageEvent(anthropicSessionId, latest);
        if (cursor) await saveCursor(target.rowId, cursor);
        return;
      }
    }
    if (latest) await accrueSessionUsageEvent(anthropicSessionId, latest);
    await accrueSessionEnd(anthropicSessionId, {
      anthropicEventId: `runtime:${anthropicSessionId}:${randomUUID()}`,
      runtime: { kind: 'fetch' },
    });
  } catch (error) {
    // Deleted upstream sessions have no remaining usage to recover.
    if (!(error instanceof NotFoundError)) throw error;
  }
  await saveCursor(target.rowId, startedAt);
}

async function saveCursor(rowId: string, cursor: Date): Promise<void> {
  await db
    .update(session)
    .set({ usageReconciledAt: sql`greatest(${session.usageReconciledAt}, ${cursor})` })
    .where(eq(session.id, rowId));
}
