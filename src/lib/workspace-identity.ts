import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { member, workspace } from '@/db/schema';

// Identity lookups for analytics captures that run where the request context
// carries no workspace or user of its own (Better Auth hooks, Stripe webhooks).
// Workspaces map one-to-one to Better Auth organizations, so either id finds
// the row; the group key on every event is the workspace row id.

/** The workspace row id for an organization, or null before provisioning. */
export async function workspaceIdForOrganization(organizationId: string): Promise<string | null> {
  const row = (
    await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.organizationId, organizationId))
      .limit(1)
  ).at(0);
  return row?.id ?? null;
}

/**
 * The owning user of a workspace (the Better Auth organization owner), or null.
 * Billing events arrive from Stripe with no user attached; the owner is the
 * person they belong to.
 */
export async function workspaceOwnerUserId(workspaceId: string): Promise<string | null> {
  const row = (
    await db
      .select({ userId: member.userId })
      .from(member)
      .innerJoin(workspace, eq(workspace.organizationId, member.organizationId))
      .where(and(eq(workspace.id, workspaceId), eq(member.role, 'owner')))
      .limit(1)
  ).at(0);
  return row?.userId ?? null;
}
