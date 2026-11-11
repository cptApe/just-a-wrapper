import { AppError, AuthorizationError } from '@/lib/errors';
import { roleIsAtLeast, type WorkspaceRole } from '@/lib/workspace-role';
import { memberChangeBlocks } from './member-change-rule';

export function assertMemberRoleChange({
  actorRole,
  target,
  organizationId,
  ownerCount,
  nextRole,
}: {
  actorRole: WorkspaceRole;
  target: { id: string; role: WorkspaceRole };
  organizationId: string;
  ownerCount: number;
  nextRole: string;
}) {
  if (!roleIsAtLeast(actorRole, 'admin')) {
    throw new AuthorizationError('Changing member roles requires owner or admin', {
      organizationId,
      actorRole: actorRole,
    });
  }
  const blocks = memberChangeBlocks({
    actorRole,
    targetRole: target.role,
    nextRole,
    ownerCount,
  });
  if (blocks.ownerRequired) {
    throw new AuthorizationError('Only an owner can change owner roles', {
      organizationId,
      actorRole: actorRole,
      targetRole: target.role,
      nextRole: nextRole,
      reason: 'OWNER_ROLE_REQUIRES_OWNER',
    });
  }
  if (blocks.soleOwner) {
    throw new AppError('SOLE_OWNER_BLOCKED', 'A workspace must retain at least one owner', {
      organizationId,
      memberId: target.id,
    });
  }
}
