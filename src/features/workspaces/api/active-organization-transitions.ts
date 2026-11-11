import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { type DbTransaction, db } from '@/db';
import { auth_session, member, workspace, workspaceNotDeleted } from '@/db/schema';
import { auth } from '@/lib/auth';
import { AppError } from '@/lib/errors';

/** Switch every device before its active workspace becomes inaccessible. */
export async function evacuateOrganizationSessions(
  tx: DbTransaction,
  organizationId: string,
  userId: string | null,
) {
  const affected = await tx
    .select({ id: auth_session.id, userId: auth_session.userId })
    .from(auth_session)
    .where(
      and(
        eq(auth_session.activeOrganizationId, organizationId),
        userId === null ? undefined : eq(auth_session.userId, userId),
      ),
    );
  for (const session of affected) {
    const next = (
      await tx
        .select({ organizationId: member.organizationId })
        .from(member)
        .innerJoin(
          workspace,
          and(eq(workspace.organizationId, member.organizationId), workspaceNotDeleted),
        )
        .where(and(eq(member.userId, session.userId), ne(member.organizationId, organizationId)))
        .orderBy(member.createdAt)
        .limit(1)
    ).at(0);
    await tx
      .update(auth_session)
      .set({ activeOrganizationId: next ? next.organizationId : null })
      .where(
        and(eq(auth_session.id, session.id), eq(auth_session.activeOrganizationId, organizationId)),
      );
  }
}

export async function activateOrganization(
  requestHeaders: Headers,
  organizationId: string,
): Promise<void> {
  const viewer = await auth.api.getSession({ headers: requestHeaders });
  if (!viewer) throw new AppError('UNAUTHENTICATED', 'Workspace switching requires a session', {});
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 5))`);
    const live = (
      await tx
        .select({ id: workspace.id })
        .from(member)
        .innerJoin(
          workspace,
          and(eq(workspace.organizationId, member.organizationId), workspaceNotDeleted),
        )
        .where(and(eq(member.userId, viewer.user.id), eq(member.organizationId, organizationId)))
        .limit(1)
    ).at(0);
    if (!live)
      throw new AppError('WORKSPACE_NOT_FOUND', 'Requested workspace is not an active membership', {
        organizationId,
      });
    const moved = await assignActiveOrganization(tx, {
      sessionId: viewer.session.id,
      userId: viewer.user.id,
      organizationId,
      expectedOrganizationId: viewer.session.activeOrganizationId ?? null,
    });
    if (!moved)
      throw new AppError('CONFLICT', 'Active workspace changed during selection', {
        organizationId,
      });
  });
}

export async function assignActiveOrganization(
  tx: DbTransaction,
  input: {
    sessionId: string;
    userId: string;
    organizationId: string;
    expectedOrganizationId: string | null;
  },
): Promise<boolean> {
  const moved = await tx
    .update(auth_session)
    .set({ activeOrganizationId: input.organizationId })
    .where(
      and(
        eq(auth_session.id, input.sessionId),
        eq(auth_session.userId, input.userId),
        input.expectedOrganizationId === null
          ? isNull(auth_session.activeOrganizationId)
          : eq(auth_session.activeOrganizationId, input.expectedOrganizationId),
      ),
    )
    .returning({ id: auth_session.id });
  if (moved.length === 1) return true;
  const current = (
    await tx
      .select({ organizationId: auth_session.activeOrganizationId })
      .from(auth_session)
      .where(and(eq(auth_session.id, input.sessionId), eq(auth_session.userId, input.userId)))
  ).at(0);
  return current?.organizationId === input.organizationId;
}
