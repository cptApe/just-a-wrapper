import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { sessionShare, session as sessionTable } from '@/db/schema';
import { schedulePublishSessionEvent } from '@/features/realtime/server';
import { revokeLiveShares } from '@/features/sessions/api/share-transitions';
import { AppError } from '@/lib/errors';
import { parseSessionId } from './session-access';
import { hideSessionTransition } from './session-transitions';

// Scope rename, favourite and soft-delete to local session id and workspace.
// Foreign or hidden sessions return SESSION_NOT_FOUND instead of resurfacing.

type SessionRef = { sessionId: string; workspaceId: string };

function notFound(input: SessionRef): AppError {
  return new AppError('SESSION_NOT_FOUND', 'Session not found', {
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
  });
}

function visibleSessionWhere(input: SessionRef) {
  return and(
    eq(sessionTable.id, parseSessionId(input.sessionId)),
    eq(sessionTable.workspaceId, input.workspaceId),
    isNull(sessionTable.hiddenAt),
  );
}

// Return the local row identity needed to route private title updates, even when no upstream
// session exists yet.
async function renameSession(input: SessionRef & { title: string }): Promise<{
  title: string;
  anthropicSessionId: string | null;
  visibility: 'private' | 'workspace';
  createdByUserId: string;
}> {
  const title = input.title.trim();
  if (title.length === 0) {
    throw new AppError('TOOL_INPUT_INVALID', 'Session title must not be empty', {
      sessionId: input.sessionId,
    });
  }
  const row = (
    await db
      .update(sessionTable)
      .set({ title })
      .where(visibleSessionWhere(input))
      // visibility + creator so the caller can route the realtime title event on
      // the right channel : a private session's rename must not leak on the
      // shared workspace channel.
      .returning({
        title: sessionTable.title,
        anthropicSessionId: sessionTable.anthropicSessionId,
        visibility: sessionTable.visibility,
        createdByUserId: sessionTable.createdByUserId,
      })
  ).at(0);
  if (!row) throw notFound(input);
  return {
    title: row.title ?? title,
    anthropicSessionId: row.anthropicSessionId,
    visibility: row.visibility,
    createdByUserId: row.createdByUserId,
  };
}

/** Toggle the favorite marker. Returns the new marker (null = unfavorited). */
async function setSessionFavorited(
  input: SessionRef & { favorited: boolean },
): Promise<{ favoritedAt: Date | null }> {
  const row = (
    await db
      .update(sessionTable)
      .set({ favoritedAt: input.favorited ? new Date() : null })
      .where(visibleSessionWhere(input))
      .returning({ favoritedAt: sessionTable.favoritedAt })
  ).at(0);
  if (!row) throw notFound(input);
  return { favoritedAt: row.favoritedAt };
}

// Soft-delete sessions because billing and audit records still reference them. Hiding must not
// orphan usage or confirmation rows.
export async function hideSession(
  input: SessionRef,
): Promise<{ visibility: 'private' | 'workspace'; createdByUserId: string }> {
  const row = (await hideSessionTransition(db, visibleSessionWhere(input))).at(0);
  if (!row) throw notFound(input);

  // Kill any live public share so a deleted task stops serving its transcript
  // immediately (the public resolver also gates on hiddenAt as defense in depth).
  await revokeLiveShares(db, eq(sessionShare.sessionId, row.id), { expiredOnly: false });
  return { visibility: row.visibility, createdByUserId: row.createdByUserId };
}

// Hides the task, then tells every member's list to drop it; the event carries no task content.
export async function deleteSession(input: SessionRef & { organizationId: string }): Promise<void> {
  const { sessionId, workspaceId, organizationId } = input;
  const session = await hideSession({ sessionId, workspaceId });
  schedulePublishSessionEvent(
    { type: 'session_visibility', sessionId, visibility: session.visibility },
    { organizationId, session },
  );
}

// Applies whichever of a rename and a pin the caller sent, and reports only those fields.
export async function updateSessionDetails(
  input: SessionRef & { organizationId: string; title?: string; favorited?: boolean },
): Promise<{ title?: string; favoritedAt?: string | null }> {
  const { sessionId, workspaceId, organizationId } = input;
  const details: { title?: string; favoritedAt?: string | null } = {};
  if (input.title !== undefined) {
    const { title, visibility, createdByUserId } = await renameSession({
      sessionId,
      workspaceId,
      title: input.title,
    });
    details.title = title;
    // Publish titles by local UUID even before upstream creation. Private tasks announce only on
    // the creator channel.
    schedulePublishSessionEvent(
      { type: 'session_title', sessionId, title },
      { organizationId, session: { visibility, createdByUserId } },
    );
  }
  if (input.favorited !== undefined) {
    const { favoritedAt } = await setSessionFavorited({
      sessionId,
      workspaceId,
      favorited: input.favorited,
    });
    details.favoritedAt = favoritedAt?.toISOString() ?? null;
  }
  return details;
}
