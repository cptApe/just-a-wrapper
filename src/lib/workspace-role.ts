// Workspace roles and the one comparison between them. Safe to import from client code.
import { z } from 'zod';

export const workspaceRoleSchema = z.enum(['owner', 'admin', 'member']);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

const ROLE_RANK: Record<WorkspaceRole, number> = { member: 0, admin: 1, owner: 2 };

/** True when `role` is `atLeast` or higher: owner is above admin, admin above member. */
export function roleIsAtLeast(role: WorkspaceRole, atLeast: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[atLeast];
}
