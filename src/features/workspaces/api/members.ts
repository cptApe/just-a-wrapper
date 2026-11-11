import 'server-only';
import { and, count, desc, eq, gt } from 'drizzle-orm';
import { db } from '@/db';
import {
  invitation,
  member,
  user,
  workspace,
  workspaceMember,
  workspaceNotDeleted,
} from '@/db/schema';
import { getMemberCycleUsage } from '@/features/billing/api/get-member-cycle-usage';
import { capabilities } from '@/lib/runtime-capabilities';

// Display reads for the /settings/workspace members section. Mutations
// (invite / cancel / resend / accept) go through Better Auth's own
// /api/auth/organization/* endpoints, which enforce role permissions
// server-side; these queries only project what the page renders. Reads join
// Better Auth's `member` / `invitation` tables directly — same DB, and the
// page is a server component, so a round-trip through auth.api would buy
// nothing.

export type WorkspaceMemberRow = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  joinedAt: Date;
  /**
   * Latest recorded activity for this member in this workspace, from
   * `workspace_member.last_active_at` (the coarse activity heartbeat authed
   * surfaces stamp). Null when they have no recorded activity yet — the row may
   * predate provisioning, or they joined but never opened the app.
   */
  lastActiveAt: Date | null;
};

export type PendingInvitationRow = {
  id: string;
  email: string;
  role: string | null;
  expiresAt: Date;
  /** Stamped at read time (server) so client components stay pure. */
  expired: boolean;
  inviterName: string | null;
};

export type UserWorkspaceRow = {
  organizationId: string;
  name: string;
  role: string;
  isActive: boolean;
};

/**
 * Every workspace the user belongs to, with the workspace display name (the
 * app-side `workspace.name`, which the shell shows — NOT `organization.name`,
 * which shares the same rename transaction) and whether it is the session's active org.
 * Feeds the top-left sidebar workspace switcher (via the (app) layout).
 */
export async function listUserWorkspaces(input: {
  userId: string;
  currentOrganizationId: string;
}): Promise<UserWorkspaceRow[]> {
  const rows = await db
    .select({
      organizationId: member.organizationId,
      name: workspace.name,
      role: member.role,
    })
    .from(member)
    // Soft-deleted workspaces drop out of the switcher — a deleted workspace is
    // gone from every listing even while its membership rows remain during the
    // internal retention buffer.
    .innerJoin(
      workspace,
      and(eq(workspace.organizationId, member.organizationId), workspaceNotDeleted),
    )
    .where(eq(member.userId, input.userId))
    .orderBy(member.createdAt);
  return rows.map((row) => ({
    ...row,
    isActive: row.organizationId === input.currentOrganizationId,
  }));
}

export async function listWorkspaceMembers(organizationId: string): Promise<WorkspaceMemberRow[]> {
  // LEFT JOIN workspace_member: both tables key on (organization_id, user_id),
  // but the app-side row can lag the Better Auth `member` row (provisioning is
  // async), so a missing app row must still list the member — with a null
  // last-active rather than dropping them.
  return db
    .select({
      memberId: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      image: user.image,
      role: member.role,
      joinedAt: member.createdAt,
      lastActiveAt: workspaceMember.lastActiveAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      workspaceMember,
      and(
        eq(workspaceMember.organizationId, member.organizationId),
        eq(workspaceMember.userId, member.userId),
      ),
    )
    .where(eq(member.organizationId, organizationId))
    .orderBy(member.createdAt);
}

// Pending only — accepted/rejected/canceled invitations are history, not work
// in progress. Expired-but-pending rows stay visible (flagged by expiresAt in
// the UI) so an admin can resend rather than wonder where the invite went.
export async function listPendingInvitations(
  organizationId: string,
): Promise<PendingInvitationRow[]> {
  const rows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      inviterName: user.name,
    })
    .from(invitation)
    .leftJoin(user, eq(user.id, invitation.inviterId))
    .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending')))
    .orderBy(desc(invitation.createdAt));
  const now = Date.now();
  return rows.map((row) => ({
    ...row,
    expired: row.expiresAt.getTime() < now,
  }));
}

// Only unexpired pending invitations reserve seats.
export async function countWorkspaceSeats(
  organizationId: string,
): Promise<{ members: number; pendingInvitations: number }> {
  const [members, invitations] = await Promise.all([
    db.select({ total: count() }).from(member).where(eq(member.organizationId, organizationId)),
    db
      .select({ total: count() })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, organizationId),
          eq(invitation.status, 'pending'),
          gt(invitation.expiresAt, new Date()),
        ),
      ),
  ]);
  return {
    members: members[0]?.total ?? 0,
    pendingInvitations: invitations[0]?.total ?? 0,
  };
}

// Every member sees the directory's credit numbers; a deployment without billing has none.
export async function getMemberDirectoryUsage(organizationId: string) {
  if (capabilities.billing.kind === 'off') return null;
  return getMemberCycleUsage(organizationId);
}
