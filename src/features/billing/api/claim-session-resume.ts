import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { session } from '@/db/schema';
import { transitionSession } from '@/features/sessions/api/session-transitions';
import { assertCanStartChat } from './assert-plan-limits';
import { checkSpend } from './spend-gate';

// A resume starts paid work again, so it passes the spend gate for the session's creator (whose
// allowance the session spends), and a chat takes a chats-at-once slot under the capacity lock.
// A spend refusal leaves the pause in place; a full workspace throws PLAN_LIMIT_REACHED.
export async function claimSessionResume(input: {
  workspaceId: string;
  anthropicSessionId: string;
}) {
  const row = (
    await db
      .select()
      .from(session)
      .where(
        and(
          eq(session.workspaceId, input.workspaceId),
          eq(session.anthropicSessionId, input.anthropicSessionId),
          eq(session.status, 'paused_no_credits'),
        ),
      )
      .limit(1)
  ).at(0);
  if (!row || !row.pausedReason || !row.pausedAt) return null;
  const { pausedReason, pausedAt } = row;
  const refusal = await checkSpend({
    entry: 'resume',
    workspaceId: row.workspaceId,
    userId: row.createdByUserId,
  });
  if (refusal) return null;
  const rows = await db.transaction(async (tx) => {
    if (row.kind === 'chat') await assertCanStartChat(row.workspaceId, tx);
    return transitionSession({
      activity: null,
      executor: tx,
      where: eq(session.id, row.id),
      to: 'resuming',
      expected: { status: row.status, version: row.stateVersion },
      pause: { reason: pausedReason, at: pausedAt },
    });
  });
  return rows.at(0) ?? null;
}
