import { APIError } from 'better-auth/api';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { member, user, workspace, workspaceMember, workspaceNotDeleted } from '@/db/schema';
import { scheduleMemberCleanup } from '@/features/integrations/api/schedule-member-cleanup';
import { assertExpectedOrganization } from '@/lib/assert-expected-organization';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { removeMembership } from './membership-transitions';

// Owner checks, membership revocation and active-workspace selection share owner locks.
export async function leaveWorkspaceMembership(
  requestHeaders: Headers,
  expectedOrganizationId: string,
): Promise<void> {
  try {
    const { organizationId, userId } = await resolveCaller(requestHeaders);
    const cleanupIds = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 5))`);
      assertExpectedOrganization(organizationId, expectedOrganizationId);
      await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update');
      const nextWorkspace = (
        await tx
          .select({ organizationId: member.organizationId })
          .from(member)
          .innerJoin(
            workspace,
            and(eq(workspace.organizationId, member.organizationId), workspaceNotDeleted),
          )
          .where(and(eq(member.userId, userId), ne(member.organizationId, organizationId)))
          .orderBy(member.createdAt)
          .limit(1)
      ).at(0);
      if (!nextWorkspace) {
        throw new AppError('LAST_WORKSPACE_BLOCKED', 'Cannot leave your only workspace', {
          organizationId,
        });
      }

      // Serialize every owner-exit decision in this workspace. A concurrent
      // leave sees the first committed deletion before it decides whether the
      // remaining owner may leave.
      const owners = await tx
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
        .for('update');
      const actor = (
        await tx
          .select({ role: member.role })
          .from(member)
          .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
          .limit(1)
      ).at(0);
      if (!actor) {
        throw new AppError('WORKSPACE_NOT_FOUND', 'Actor is not a member of the active workspace', {
          organizationId,
          userId: userId,
        });
      }
      if (actor.role === 'owner' && owners.length <= 1) {
        throw new AppError('SOLE_OWNER_BLOCKED', 'Cannot leave as the sole owner', {
          organizationId,
        });
      }

      const resources = await tx
        .select({ id: workspaceMember.composioUserId })
        .from(workspaceMember)
        .where(
          and(
            eq(workspaceMember.organizationId, organizationId),
            eq(workspaceMember.userId, userId),
          ),
        );
      if (!(await removeMembership(tx, organizationId, userId)))
        throw new AppError('CONFLICT', 'Membership already removed', { organizationId });
      return resources.map(({ id }) => id);
    });
    scheduleMemberCleanup(cleanupIds);
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    if (cause instanceof APIError && cause.statusCode === 400) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Better Auth rejected the workspace leave',
        {},
        { cause },
      );
    }
    throw new AppError('API_REQUEST_FAILED', 'Workspace leave failed', {}, { cause });
  }
}
