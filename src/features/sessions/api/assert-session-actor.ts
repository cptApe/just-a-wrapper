import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { member, session, workspace } from '@/db/schema';
import { AuthorizationError } from '@/lib/errors';
import { roleIsAtLeast } from '@/lib/workspace-role';

// Provider memory permissions cannot be reduced after creation. Refuse further work after demotion.
export async function assertSessionActor(sessionId: string, userId: string): Promise<void> {
  const refusal = await sessionActorRefusal(sessionId, userId);
  if (refusal) throw refusal;
}

/** Why the creator may no longer act on this session, or null while they may. */
export async function sessionActorRefusal(
  sessionId: string,
  userId: string,
): Promise<AuthorizationError | null> {
  const row = (
    await db
      .select({ role: member.role, access: session.workspaceMemoryAccess })
      .from(session)
      .innerJoin(workspace, eq(workspace.id, session.workspaceId))
      .innerJoin(
        member,
        and(eq(member.organizationId, workspace.organizationId), eq(member.userId, userId)),
      )
      .where(and(eq(session.id, sessionId), eq(session.createdByUserId, userId)))
      .limit(1)
  ).at(0);
  if (!row)
    return new AuthorizationError('The task creator is no longer a workspace member', {
      sessionId,
      userId,
    });
  if (row.access === 'read_write' && !roleIsAtLeast(row.role, 'admin')) {
    return new AuthorizationError('Start a new task after your workspace role changes', {
      sessionId,
      userId,
    });
  }
  return null;
}
