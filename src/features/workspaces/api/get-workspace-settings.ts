import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { member, organization, workspace, workspaceNotDeleted } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { roleIsAtLeast, type WorkspaceRole } from '@/lib/workspace-role';
import { listUserWorkspaces } from './members';

// Everything the /settings/workspace page paints in one server read: the active
// workspace's identity (id for the icon-upload path, name, and the org `logo`
// the icon renders), the caller's role, and the two facts the Danger zone gates
// on — whether the caller is the workspace's sole owner (blocks leaving) and how
// many workspaces they still belong to (you must always keep one). Derived here,
// server-side, so the client controls render disabled-with-reason rather than a
// doomed action. Soft-deleted workspaces don't resolve (workspaceNotDeleted), so
// a deleted active workspace throws WORKSPACE_NOT_FOUND, which the page's loader
// lets propagate to its error boundary.

export type WorkspaceSettings = {
  workspaceId: string;
  organizationId: string;
  name: string;
  /** The org `logo` — the workspace icon; null renders the initials fallback. */
  logo: string | null;
  role: WorkspaceRole;
  isAdmin: boolean;
  isOwner: boolean;
  /** Owner AND the only owner in the org — leaving would orphan the workspace. */
  isSoleOwner: boolean;
  /** How many non-deleted workspaces the caller belongs to (this one included). */
  workspaceCount: number;
};

export async function getWorkspaceSettings(input: {
  organizationId: string;
  userId: string;
  role: WorkspaceRole;
}): Promise<WorkspaceSettings> {
  const { organizationId, userId, role } = input;

  const row = (
    await db
      .select({ id: workspace.id, name: workspace.name, logo: organization.logo })
      .from(workspace)
      .innerJoin(organization, eq(organization.id, workspace.organizationId))
      .where(and(eq(workspace.organizationId, organizationId), workspaceNotDeleted))
      .limit(1)
  ).at(0);
  if (!row) {
    throw new AppError('WORKSPACE_NOT_FOUND', 'No workspace for active organization', {
      organizationId,
    });
  }

  const isOwner = role === 'owner';

  // The final owner cannot leave until another member owns the workspace.
  let isSoleOwner = false;
  if (isOwner) {
    const owners = await db
      .select({ role: member.role })
      .from(member)
      .where(eq(member.organizationId, organizationId));
    isSoleOwner = owners.filter((m) => m.role === 'owner').length <= 1;
  }

  // Reuse the switcher's listing — already scoped to non-deleted workspaces — so
  // "your only workspace" can't drift from what the switcher shows.
  const workspaces = await listUserWorkspaces({
    userId,
    currentOrganizationId: organizationId,
  });

  return {
    workspaceId: row.id,
    organizationId,
    name: row.name,
    logo: row.logo,
    role,
    isAdmin: roleIsAtLeast(role, 'admin'),
    isOwner,
    isSoleOwner,
    workspaceCount: workspaces.length,
  };
}
