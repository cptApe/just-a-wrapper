import { workspaceCreditBalance } from '@/features/billing/lib/workspace-credit-balance';
import {
  NOT_CONFIGURED,
  resolveIntegrationMember,
} from '@/features/integrations/api/connection-context';
import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { member, user as userTable, workspace } from '@/db/schema';
import { loadMemberIntegrations } from '@/features/integrations/api/load-member-integrations';
import { resolveEffectiveTimeZone } from '@/features/preferences/lib/time-preferences';
import { listSkillsForWorkspace } from '@/features/skills/server';
import {
  GET_USER_CONTEXT_DECL,
  type GetUserContextInput,
  GetUserContextInputSchema,
  type GetUserContextOutput,
  GetUserContextOutputSchema,
  pickPlanName,
  projectUserContext,
  UNLIMITED_PLAN_NAME,
} from '@/features/tool-catalog/get-user-context';
import type { CustomTool } from '@/features/tool-catalog/types';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { capabilities } from '@/lib/runtime-capabilities';

// Read the caller’s current context from owning feature APIs using workspace and user ids.
// Balance comes from the workspace row, role from membership, and plan from local pricing.
// Reuse integration and skill reads; configured connected-app outages fail explicitly.
// This safe tool has no input and cannot select another member’s context.

const DEFAULT_ROLE = 'member';

async function resolveConnectedApps(organizationId: string, userId: string): Promise<string[]> {
  const result = await loadMemberIntegrations(
    await resolveIntegrationMember({ organizationId, userId }),
  );
  if (result.status === 'notice' && result.notice === NOT_CONFIGURED) return [];
  if (result.status !== 'ok') {
    throw new AppError('EXTERNAL_API_FAILED', 'Could not resolve connected apps for task creator', {
      organizationId,
      userId,
    });
  }
  return result.integrations
    .filter((integration) => integration.connected)
    .map((integration) => integration.name);
}

export const getUserContextTool: CustomTool<GetUserContextInput, GetUserContextOutput> = {
  ...GET_USER_CONTEXT_DECL,
  inputSchema: GetUserContextInputSchema,
  outputSchema: GetUserContextOutputSchema,
  async handler(_input, ctx) {
    const { ws, userRow } = await loadUserWorkspace(ctx);

    const [roleRows, plan, connectedApps, skills] = await Promise.all([
      db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, ws.organizationId), eq(member.userId, ctx.userId)))
        .limit(1),
      capabilities.billing.kind === 'off' ? UNLIMITED_PLAN_NAME : pickPlanName(ws.planTier),
      resolveConnectedApps(ws.organizationId, ctx.userId),
      listSkillsForWorkspace({ workspaceId: ctx.workspaceId }),
    ]);

    return projectUserContext({
      displayName: userRow.name || null,
      email: userRow.email,
      timezone: resolveEffectiveTimeZone(userRow, logger()),
      workspaceName: ws.name || null,
      role: roleRows[0]?.role ?? DEFAULT_ROLE,
      plan,
      creditsRemaining: ws.creditBalance,
      connectedApps,
      skills: skills.map((s) => s.name),
    });
  },
};

async function loadUserWorkspace(ctx: Parameters<typeof getUserContextTool.handler>[1]) {
  const [wsRows, userRows] = await Promise.all([
    db
      .select({
        organizationId: workspace.organizationId,
        name: workspace.name,
        creditBalance: workspaceCreditBalance,
        planTier: workspace.planTier,
      })
      .from(workspace)
      .where(eq(workspace.id, ctx.workspaceId))
      .limit(1),
    db
      .select({
        name: userTable.name,
        email: userTable.email,
        timezone: userTable.timezone,
        browserTimezone: userTable.browserTimezone,
      })
      .from(userTable)
      .where(eq(userTable.id, ctx.userId))
      .limit(1),
  ]);

  const ws = wsRows.at(0);
  if (!ws) {
    // The dispatcher only reaches a handler after resolving the caller's own
    // workspace, so a missing row is a real invariant break, not a user state.
    throw new AppError('WORKSPACE_NOT_FOUND', 'workspace row missing for get_user_context', {
      workspaceId: ctx.workspaceId,
    });
  }
  const userRow = userRows.at(0);
  if (!userRow) {
    throw new AppError('UNEXPECTED', 'user row missing for get_user_context', {
      userId: ctx.userId,
    });
  }

  return { ws, userRow };
}
