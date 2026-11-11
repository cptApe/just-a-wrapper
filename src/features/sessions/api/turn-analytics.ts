import { and, desc, eq, gt, lte, ne } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable, sessionTurnClaim, usageEvent } from '@/db/schema';
import { captureEvent } from '@/lib/analytics';
import { type CompletedTurn, spendBreakdown, turnCompleteProperties } from '../lib/turn-metrics';

async function claimTurn(sessionId: string, terminalEventId: string) {
  const inserted = await db
    .insert(sessionTurnClaim)
    .values({ sessionId, terminalEventId })
    .onConflictDoNothing({ target: [sessionTurnClaim.sessionId, sessionTurnClaim.terminalEventId] })
    .returning({ terminalEventId: sessionTurnClaim.terminalEventId });
  return inserted.length > 0;
}

async function loadSession(anthropicSessionId: string) {
  const row = (
    await db
      .select({
        rowId: sessionTable.id,
        workspaceId: sessionTable.workspaceId,
        createdByUserId: sessionTable.createdByUserId,
        tier: sessionTable.tier,
      })
      .from(sessionTable)
      .where(eq(sessionTable.anthropicSessionId, anthropicSessionId))
      .limit(1)
  ).at(0);
  return row ?? null;
}

// The previous turn's claim marks where this turn's usage begins. Usage that lands after `endedAt`
// (a late accrual) counts toward the next turn, so per-turn totals add up to the session total.
async function loadTurnSpend(rowId: string, terminalEventId: string, endedAt: Date) {
  const previous = (
    await db
      .select({ claimedAt: sessionTurnClaim.claimedAt })
      .from(sessionTurnClaim)
      .where(
        and(
          eq(sessionTurnClaim.sessionId, rowId),
          ne(sessionTurnClaim.terminalEventId, terminalEventId),
        ),
      )
      .orderBy(desc(sessionTurnClaim.claimedAt))
      .limit(1)
  ).at(0);
  const rows = await db
    .select({ eventType: usageEvent.eventType, creditsDelta: usageEvent.creditsDelta })
    .from(usageEvent)
    .where(
      and(
        eq(usageEvent.sessionId, rowId),
        lte(usageEvent.createdAt, endedAt),
        ...(previous ? [gt(usageEvent.createdAt, previous.claimedAt)] : []),
      ),
    );
  return rows.map((row) => ({ eventType: row.eventType, credits: -row.creditsDelta }));
}

// Claim terminal IDs before analytics so multiple relays cannot double-count a turn. The
// background boundary reports capture failures.
export async function captureCompletedTurn(input: {
  anthropicSessionId: string;
  terminalEventId: string;
  turn: CompletedTurn;
}): Promise<'captured' | 'replay' | 'unknown-session'> {
  const session = await loadSession(input.anthropicSessionId);
  if (!session) return 'unknown-session';
  if (!(await claimTurn(session.rowId, input.terminalEventId))) return 'replay';
  const identity = { userId: session.createdByUserId, workspaceId: session.workspaceId };
  captureEvent(
    'session:turn_complete',
    { ...turnCompleteProperties(input.turn), tier: session.tier },
    identity,
  );
  const spend = spendBreakdown(
    await loadTurnSpend(session.rowId, input.terminalEventId, new Date(input.turn.endedAt)),
  );
  if (spend.credits > 0) {
    captureEvent(
      'billing:credit_spend',
      { ...spend, usage_kind: 'turn', tier: session.tier },
      identity,
    );
  }
  return 'captured';
}
