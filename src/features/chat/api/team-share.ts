'use server';

import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';
import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';
import { type ActionState, runAction } from '@/lib/action-state';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { CHAT_ACTION } from '../constants';
import { assertThreadOwner } from '../lib/share-authz';

// Team sharing changes session visibility from private to workspace; public links stay separate.
// Only the creator can mutate sharing. Unknown, foreign and non-owned threads
// share the same not-found response. Idempotent changes do not re-notify.

const SessionIdInput = z.string().uuid();

type OwnedSessionRow = {
  id: string;
  title: string | null;
  visibility: 'private' | 'workspace';
};

/**
 * Resolve the session row, asserting it belongs to `workspaceId` AND was created
 * by `userId` (only the creator may change team visibility). Returns the fields
 * the actions need (title for the notification, current visibility for
 * idempotency).
 */
async function resolveOwnedSession(
  sessionRowId: string,
  workspaceId: string,
  userId: string,
): Promise<OwnedSessionRow> {
  const row = (
    await db
      .select({
        id: sessionTable.id,
        createdByUserId: sessionTable.createdByUserId,
        title: sessionTable.title,
        visibility: sessionTable.visibility,
      })
      .from(sessionTable)
      .where(and(eq(sessionTable.id, sessionRowId), eq(sessionTable.workspaceId, workspaceId)))
      .limit(1)
  ).at(0);
  assertThreadOwner(row, userId, { sessionId: sessionRowId, workspaceId });
  // assertThreadOwner throws unless the row exists and is owned, so this repeat
  // throw is unreachable — it exists to narrow `row` for the type checker.
  if (!row) {
    throw new AppError('SESSION_NOT_FOUND', 'session not found', {
      sessionId: sessionRowId,
      workspaceId,
    });
  }
  return { id: row.id, title: row.title, visibility: row.visibility };
}

/**
 * Current team-visibility of a task — powers the Team switch's initial state.
 * Creator-only (same gate as the mutations), so a non-creator can never read it.
 */
export async function getSessionTeamVisibility(
  sessionId: string,
): Promise<ActionState<{ visibility: 'private' | 'workspace' }>> {
  return runAction({ ...CHAT_ACTION, route: 'chat/team-share/get', op: 'get' }, async () => {
    const parsedSessionId = SessionIdInput.parse(sessionId);
    const { workspaceId, userId } = await resolveCaller(await headers());
    const row = await resolveOwnedSession(parsedSessionId, workspaceId, userId);
    return { visibility: row.visibility };
  });
}
