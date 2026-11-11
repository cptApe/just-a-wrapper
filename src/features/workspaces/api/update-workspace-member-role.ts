import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { member } from '@/db/schema';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { workspaceRoleSchema } from '@/lib/workspace-role';
import { assertMemberRoleChange } from '../lib/member-role-change';
import { lockWorkspaceMembers } from './lock-workspace-members';
import { moveMemberRole } from './member-role-transitions';

const roleChangeInput = z
  .object({
    memberId: z.string().min(1),
    role: workspaceRoleSchema,
  })
  .strict();

// Role guards and the role write share the transaction holding owner locks.
export async function updateWorkspaceMemberRole(
  input: unknown,
  requestHeaders: Headers,
): Promise<void> {
  const parsed = roleChangeInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'role change input failed validation', {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const caller = await resolveCaller(requestHeaders);
  await db.transaction(async (tx) => {
    const { organizationId, owners, actor } = await lockWorkspaceMembers(tx, caller);
    const target = (
      await tx
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.id, parsed.data.memberId)))
        .limit(1)
    ).at(0);
    if (!target) {
      throw new AppError('VALIDATION_FAILED', 'Role-change target is not in the active workspace', {
        organizationId,
        memberId: parsed.data.memberId,
      });
    }

    assertMemberRoleChange({
      actorRole: actor.role,
      target,
      organizationId,
      ownerCount: owners.length,
      nextRole: parsed.data.role,
    });
    if (target.role === parsed.data.role) return;

    if (
      !(await moveMemberRole(tx, {
        memberId: target.id,
        organizationId,
        from: target.role,
        to: parsed.data.role,
      }))
    ) {
      throw new AppError('CONFLICT', 'Member role changed before this request completed', {
        memberId: target.id,
      });
    }
  });
}
