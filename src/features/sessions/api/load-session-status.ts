import { publicSessionStatus } from '../lib/session-machine';
import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';
import { safeParseSessionId, sessionVisibleToViewer } from './session-access';

type SessionLiveStatus =
  | 'idle'
  | 'running'
  | 'rescheduling'
  | 'requires_input'
  | 'paused_no_credits'
  | 'terminated';
export type SessionPauseReason = 'credits' | 'budget' | 'member_limit';
export type SessionLiveState = {
  status: SessionLiveStatus;
  pausedReason: SessionPauseReason | null;
};

// Credit pauses exist only in local state, not Anthropic status events. Scope this read by viewer
// and workspace; missing or private tasks return no banner.
export async function loadSessionStatus(input: {
  sessionId: string;
  workspaceId: string;
  /** The viewer, for the visibility gate — another member's private task reads null. */
  viewerId: string;
}): Promise<SessionLiveState | null> {
  const sessionId = safeParseSessionId(input.sessionId);
  if (!sessionId) return null;
  const row = (
    await db
      .select({ status: sessionTable.status, pausedReason: sessionTable.pausedReason })
      .from(sessionTable)
      .where(
        and(
          eq(sessionTable.id, sessionId),
          eq(sessionTable.workspaceId, input.workspaceId),
          sessionVisibleToViewer(input.viewerId),
        ),
      )
      .limit(1)
  ).at(0);
  return row ? { ...row, status: publicSessionStatus(row.status) } : null;
}
