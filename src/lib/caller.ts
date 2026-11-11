// The one place that turns a request into a signed-in person and their workspace.
// No other module reads the auth session (lint: just-a-wrapper/no-direct-session-read).
// See docs/decisions/0025-one-caller-resolver.md.
import 'server-only';
import { and, eq } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/db';
import { member, workspace, workspaceNotDeleted } from '@/db/schema';
import { auth } from '@/lib/auth';
import { AppError, AuthorizationError } from '@/lib/errors';
import { ctx } from '@/lib/request-context';
import { roleIsAtLeast, type WorkspaceRole, workspaceRoleSchema } from '@/lib/workspace-role';

export type SignedInUser = { userId: string; email: string; name: string };

/** A signed-in person acting in a live workspace they are a member of right now. */
export type Caller = SignedInUser & {
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
};

// One auth read per server render. Route handlers run outside React's cache scope and read once.
const readAuthSession = cache((headers: Headers) => auth.api.getSession({ headers }));

const DEFAULT_REFUSAL: Record<'admin' | 'owner', string> = {
  admin: 'This action requires a workspace owner or admin',
  owner: 'This action requires the workspace owner',
};

/** The signed-in person, for surfaces that exist before or outside a workspace. */
export async function resolveUser(headers: Headers): Promise<SignedInUser> {
  const session = await readAuthSession(headers);
  if (!session) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.', {});
  return { userId: session.user.id, email: session.user.email, name: session.user.name };
}

/**
 * The caller, or null when the signed-in person has no live workspace to act in:
 * no active organization, a membership that has ended, or a workspace being deleted.
 * The active-organization pointer on the auth session is never trusted alone.
 */
export async function findCaller(headers: Headers): Promise<Caller | null> {
  const session = await readAuthSession(headers);
  if (!session) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.', {});
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return null;
  const row = (
    await db
      .select({ role: member.role, workspaceId: workspace.id, workspaceName: workspace.name })
      .from(member)
      .innerJoin(
        workspace,
        and(eq(workspace.organizationId, member.organizationId), workspaceNotDeleted),
      )
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
      .limit(1)
  ).at(0);
  if (!row) return null;
  const caller: Caller = {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    organizationId,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    role: workspaceRoleSchema.parse(row.role),
  };
  // Logs carry the authorized tenant from here on, when the entry point opened a context.
  const requestContext = ctx();
  if (requestContext) {
    requestContext.workspace_id = caller.workspaceId;
    requestContext.organization_id = caller.organizationId;
    requestContext.user_id = caller.userId;
  }
  return caller;
}

/**
 * The caller, required. Throws UNAUTHENTICATED when signed out, WORKSPACE_NOT_FOUND
 * when there is no live membership, and FORBIDDEN when the role is below `atLeast`.
 */
export async function resolveCaller(
  headers: Headers,
  need: { atLeast?: 'admin' | 'owner'; refusal?: string } = {},
): Promise<Caller> {
  const caller = await findCaller(headers);
  if (!caller) throw new AppError('WORKSPACE_NOT_FOUND', 'Workspace not found', {});
  if (need.atLeast && !roleIsAtLeast(caller.role, need.atLeast)) {
    throw new AuthorizationError(need.refusal ?? DEFAULT_REFUSAL[need.atLeast], {
      organizationId: caller.organizationId,
      userId: caller.userId,
      role: caller.role,
    });
  }
  return caller;
}
