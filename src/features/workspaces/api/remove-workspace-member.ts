import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { member, workspaceMember } from '@/db/schema';
import { scheduleMemberCleanup } from '@/features/integrations/api/schedule-member-cleanup';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { assertMemberRemoval } from '../lib/member-removal';
import { lockWorkspaceMembers } from './lock-workspace-members';
import { removeMembership } from './membership-transitions';

const memberRemovalInput = z.object({ memberId: z.string().min(1) }).strict();

// Membership revocation and owner checks share a transaction; providers clean up after commit.
export async function removeWorkspaceMember(
  input: unknown,
  requestHeaders: Headers,
): Promise<void> {
  const parsed = memberRemovalInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'member removal input failed validation', {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const caller = await resolveCaller(requestHeaders);
  const cleanupIds = await db.transaction(async (tx) => {
    const { organizationId, owners, actor } = await lockWorkspaceMembers(tx, caller);
    const target = (
      await tx
        .select({ id: member.id, role: member.role, userId: member.userId })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.id, parsed.data.memberId)))
        .limit(1)
    ).at(0);
    if (!target) {
      throw new AppError('VALIDATION_FAILED', 'Removal target is not in the active workspace', {
        organizationId,
        memberId: parsed.data.memberId,
      });
    }

    assertMemberRemoval({
      actorRole: actor.role,
      target,
      organizationId,
      ownerCount: owners.length,
    });

    // Leaving carries the last-workspace and sole-owner checks; removal does not.
    if (target.userId === caller.userId) {
      throw new AppError('VALIDATION_FAILED', 'Members remove themselves by leaving', {
        organizationId,
        memberId: target.id,
        reason: 'USE_LEAVE_WORKSPACE',
      });
    }

    const resources = await tx
      .select({ id: workspaceMember.composioUserId })
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.organizationId, organizationId),
          eq(workspaceMember.userId, target.userId),
        ),
      );
    if (!(await removeMembership(tx, organizationId, target.userId)))
      throw new AppError('CONFLICT', 'Member was already removed', { memberId: target.id });
    return resources.map(({ id }) => id);
  });
  scheduleMemberCleanup(cleanupIds);
}
