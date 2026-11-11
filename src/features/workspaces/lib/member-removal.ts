import { AppError, AuthorizationError } from '@/lib/errors';
import { roleIsAtLeast, type WorkspaceRole } from '@/lib/workspace-role';
import { memberChangeBlocks } from './member-change-rule';

export function assertMemberRemoval({
  actorRole,
  target,
  organizationId,
  ownerCount,
}: {
  actorRole: WorkspaceRole;
  target: { id: string; role: WorkspaceRole };
  organizationId: string;
  ownerCount: number;
}) {
  if (!roleIsAtLeast(actorRole, 'admin')) {
    throw new AuthorizationError('Removing members requires owner or admin', {
      organizationId,
      actorRole: actorRole,
    });
  }
  const blocks = memberChangeBlocks({ actorRole, targetRole: target.role, ownerCount });
  if (blocks.ownerRequired) {
    throw new AuthorizationError('Only an owner can remove another owner', {
      organizationId,
      actorRole: actorRole,
      targetRole: target.role,
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
