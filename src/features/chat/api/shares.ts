'use server';
import { and, desc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';
import { db } from '@/db';
import { sessionShare, session as sessionTable } from '@/db/schema';
import { schedulePublishSessionEvent } from '@/features/realtime/server';
import { changeSessionSharing } from '@/features/sessions/api/share-transitions';
import { type ActionState, runAction } from '@/lib/action-state';
import { captureEvent } from '@/lib/analytics';
import { resolveCaller } from '@/lib/caller';
import { env } from '@/lib/env';
import { isShareLive } from '@/lib/share-token';
import { CHAT_ACTION } from '../constants';
import { assertThreadOwner } from '../lib/share-authz';
import type { SessionShareSummary } from '../types';
import { scheduleTeamShareNotification } from './share-notifications';

// Public task links are view-only and valid only while unexpired and unrevoked.
// Resolve workspace from auth and gate the local session uuid by ownership.
// Never trust a client-supplied workspace.
const SessionIdInput = z.string().uuid();

function shareUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/share/${token}`;
}

function toSummary(row: typeof sessionShare.$inferSelect): SessionShareSummary {
  return {
    id: row.id,
    sessionId: row.sessionId,
    token: row.token,
    url: shareUrl(row.token),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Resolve the session row, asserting it belongs to `workspaceId` AND was
 * created by `userId` (only the thread's owner
 * may share it). Same `SESSION_NOT_FOUND`-on-mismatch contract as the sessions
 * feature: a foreign / unknown / non-owned thread is indistinguishable so neither
 * existence nor ownership leaks.
 */
async function resolveOwnedSessionRowId(
  sessionRowId: string,
  workspaceId: string,
  userId: string,
): Promise<string> {
  const row = (
    await db
      .select({ id: sessionTable.id, createdByUserId: sessionTable.createdByUserId })
      .from(sessionTable)
      .where(and(eq(sessionTable.id, sessionRowId), eq(sessionTable.workspaceId, workspaceId)))
      .limit(1)
  ).at(0);
  return assertThreadOwner(row, userId, { sessionId: sessionRowId, workspaceId });
}

/** The current live (non-revoked, non-expired) share for a thread, or null. */
async function findLiveShare(
  sessionRowId: string,
  workspaceId: string,
): Promise<typeof sessionShare.$inferSelect | null> {
  const rows = await db
    .select()
    .from(sessionShare)
    .where(and(eq(sessionShare.sessionId, sessionRowId), eq(sessionShare.workspaceId, workspaceId)))
    .orderBy(desc(sessionShare.createdAt));
  const now = new Date();
  return (
    rows.find((r) => isShareLive({ expiresAt: r.expiresAt, revokedAt: r.revokedAt }, now)) ?? null
  );
}

/** The current live share for a thread, or null — powers the share menu's state. */
export async function getSessionShare(
  sessionId: string,
): Promise<ActionState<SessionShareSummary | null>> {
  return runAction({ ...CHAT_ACTION, route: 'chat/shares/get', op: 'get' }, async () => {
    const parsedSessionId = SessionIdInput.parse(sessionId);
    const { workspaceId, userId } = await resolveCaller(await headers());
    const sessionRowId = await resolveOwnedSessionRowId(parsedSessionId, workspaceId, userId);
    const live = await findLiveShare(sessionRowId, workspaceId);
    return live ? toSummary(live) : null;
  });
}

export async function setSessionShareChoice(
  sessionId: string,
  choice: 'private' | 'team' | 'public',
): Promise<
  ActionState<{ share: SessionShareSummary | null; visibility: 'private' | 'workspace' }>
> {
  return runAction({ ...CHAT_ACTION, route: 'chat/shares/choice', op: 'share' }, async () => {
    const parsedSessionId = SessionIdInput.parse(sessionId);
    const change = z.enum(['private', 'team', 'public']).parse(choice);
    const { workspaceId, userId, organizationId } = await resolveCaller(await headers());
    const changed = await changeSessionSharing({
      sessionId: parsedSessionId,
      workspaceId,
      userId,
      change,
    });
    if (changed.created)
      captureEvent(
        'share:create',
        { kind: 'task_link', session_id: sessionId },
        { userId, workspaceId },
      );
    if (changed.changed && changed.visibility === 'workspace')
      captureEvent(
        'share:create',
        { kind: 'task_team', session_id: sessionId },
        { userId, workspaceId },
      );
    if (changed.changed)
      schedulePublishSessionEvent(
        { type: 'session_visibility', sessionId, visibility: changed.visibility },
        { organizationId, session: { visibility: changed.visibility, createdByUserId: userId } },
      );
    if (changed.changed && changed.visibility === 'workspace')
      scheduleTeamShareNotification({ organizationId, userId, sessionId, title: changed.title });
    return {
      share: changed.share ? toSummary(changed.share) : null,
      visibility: changed.visibility,
    };
  });
}
