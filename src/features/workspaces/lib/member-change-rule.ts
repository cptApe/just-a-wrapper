import type { WorkspaceRole } from '@/lib/workspace-role';

export type MemberChangeBlocks = { ownerRequired: boolean; soleOwner: boolean };

// Pure so the server asserts and the members menu apply one owner rule. A role
// change passes the next role; a removal omits it. Both reasons can hold at
// once, so each caller picks the one it reports first.
export function memberChangeBlocks({
  actorRole,
  targetRole,
  nextRole,
  ownerCount,
}: {
  actorRole: WorkspaceRole;
  targetRole: WorkspaceRole;
  nextRole?: WorkspaceRole | string;
  ownerCount: number;
}): MemberChangeBlocks {
  const touchesOwner = targetRole === 'owner' || nextRole === 'owner';
  const losesOwner = targetRole === 'owner' && nextRole !== 'owner';
  return {
    ownerRequired: actorRole !== 'owner' && touchesOwner,
    soleOwner: losesOwner && ownerCount <= 1,
  };
}
