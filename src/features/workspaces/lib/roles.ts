import type { WorkspaceRole } from '@/lib/workspace-role';
import { memberChangeBlocks } from './member-change-rule';
import { USE_LEAVE_WORKSPACE_COPY } from './workspace-error-copy';

// Workspace role vocabulary, shared by server (caller) and client (the
// Members list, invite modal, pending invites). Pure and client-safe — it must
// NOT depend on anything server-only, since client components import it.

export type { WorkspaceRole };

/** Most-privileged first, for role pickers and iteration. */
export const WORKSPACE_ROLES = [
  'owner',
  'admin',
  'member',
] as const satisfies readonly WorkspaceRole[];

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

/** Explain why a role change is unavailable. A workspace must always retain an
 * owner, but any owner can step down once another owner exists. */
export function roleChangeBlockedReason(
  actorRole: WorkspaceRole,
  currentRole: WorkspaceRole,
  nextRole: WorkspaceRole,
  ownerCount: number,
): string | null {
  const blocks = memberChangeBlocks({ actorRole, targetRole: currentRole, nextRole, ownerCount });
  if (blocks.ownerRequired) return 'Only an owner can change owner roles';
  if (blocks.soleOwner) return 'Make someone else an owner before changing this role';
  return null;
}

/** Explain why "Remove from workspace" is unavailable on a row, before the server refuses it. */
export function removalBlockedReason(
  actorRole: WorkspaceRole,
  target: { role: WorkspaceRole; isViewer: boolean },
  ownerCount: number,
): string | null {
  if (target.isViewer) return USE_LEAVE_WORKSPACE_COPY;
  const blocks = memberChangeBlocks({ actorRole, targetRole: target.role, ownerCount });
  if (blocks.soleOwner) return 'Make someone else an owner before removing the sole owner';
  if (blocks.ownerRequired) return 'Only an owner can remove another owner';
  return null;
}

/** Explain why the invite dialog cannot offer a role: only an owner may invite an owner. */
export function inviteRoleBlockedReason(
  actorRole: WorkspaceRole,
  role: WorkspaceRole,
): string | null {
  return roleChangeBlockedReason(actorRole, 'member', role, 1);
}

/** Null invitation roles display as member; persisted member roles are CHECK-constrained. */
export function primaryRole(role: string | null | undefined): WorkspaceRole {
  if (role === 'owner' || role === 'admin') return role;
  return 'member';
}
