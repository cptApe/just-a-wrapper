import 'server-only';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { sessionReadState, session as sessionTable, workspaceMember } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { parseSessionId, sessionVisibleToViewer } from './session-access';

// Mark seen by upserting viewer session_read_state; unread compares it with last_event_at.
// Also stamp coarse member activity so viewing a task suppresses away email.
// The shell calls the seen route while the task is active.

const MIN_ACTIVITY_INTERVAL_MS = 60_000;

export async function markSessionSeen(input: {
  sessionId: string;
  workspaceId: string;
  userId: string;
  organizationId: string;
}): Promise<void> {
  // Same (session.id, workspace_id) scoping contract as session-access /
  // update-session: a caller can never mark another tenant's session, and a
  // soft-deleted session 404s.
  const row = (
    await db
      .select({ id: sessionTable.id })
      .from(sessionTable)
      .where(
        and(
          eq(sessionTable.id, parseSessionId(input.sessionId)),
          eq(sessionTable.workspaceId, input.workspaceId),
          isNull(sessionTable.hiddenAt),
          // you can only mark-seen a task you can see (yours or workspace-shared).
          sessionVisibleToViewer(input.userId),
        ),
      )
      .limit(1)
  ).at(0);
  if (!row) {
    throw new AppError('SESSION_NOT_FOUND', 'Session not found', {
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
    });
  }

  const now = new Date();
  await db
    .insert(sessionReadState)
    .values({
      workspaceId: input.workspaceId,
      sessionId: row.id,
      userId: input.userId,
      lastReadAt: now,
    })
    .onConflictDoUpdate({
      target: [sessionReadState.sessionId, sessionReadState.userId],
      set: { lastReadAt: now },
      // Monotonic: never move the marker backwards under concurrent writes.
      setWhere: sql`${sessionReadState.lastReadAt} < ${now.toISOString()}::timestamptz`,
    });

  await touchMemberActivity({ organizationId: input.organizationId, userId: input.userId });
}

// Debounce member activity writes to bound database load while keeping away-email decisions
// current.
async function touchMemberActivity(input: {
  organizationId: string;
  userId: string;
}): Promise<void> {
  const now = new Date();
  const floor = new Date(now.getTime() - MIN_ACTIVITY_INTERVAL_MS);
  await db
    .update(workspaceMember)
    .set({ lastActiveAt: now })
    .where(
      and(
        eq(workspaceMember.organizationId, input.organizationId),
        eq(workspaceMember.userId, input.userId),
        or(isNull(workspaceMember.lastActiveAt), lt(workspaceMember.lastActiveAt, floor)),
      ),
    );
}
