'use server';

import { and, eq, ne, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { member, user, workspace, workspaceNotDeleted } from '@/db/schema';
import { type ActionState, runAction } from '@/lib/action-state';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { snapshotCtx, withRequestContext } from '@/lib/request-context';
import { sweepDeadline } from '@/lib/sweep-deadline';
import { workspaceActionBoundary } from '../lib/workspace-error-copy';
import { evacuateOrganizationSessions } from './active-organization-transitions';
import { leaveWorkspaceMembership } from './leave-workspace-membership';
import { finishDeletingWorkspaces } from './purge-expired';
import { claimWorkspaceDeletion } from './workspace-lifecycle-transitions';

// Soft deletion retains organization data for the purge retention window.
// Form boundaries return safe ActionState copy because production masks thrown messages.

export async function leaveWorkspace(
  expectedOrganizationId: string,
): Promise<ActionState<'LEFT' | 'DELETED'>> {
  return runAction(workspaceActionBoundary('settings-workspace-leave', 'leave'), async () => {
    await leaveWorkspaceMembership(await headers(), expectedOrganizationId);
    return 'LEFT' as const;
  });
}

const deletionInput = z
  .object({ confirmName: z.string().min(1), workspaceId: z.string().uuid() })
  .strict();

export async function deleteWorkspace(input: unknown): Promise<ActionState<'LEFT' | 'DELETED'>> {
  return runAction(
    workspaceActionBoundary('settings-workspace-delete', 'deleteWorkspace'),
    async () => {
      const parsed = deletionInput.safeParse(input);
      if (!parsed.success)
        throw new AppError(
          'VALIDATION_FAILED',
          'Invalid workspace deletion input',
          {},
          { cause: parsed.error },
        );
      // Only an owner can destroy the workspace.
      const { organizationId, userId } = await resolveCaller(await headers(), {
        atLeast: 'owner',
        refusal: 'Deleting a workspace requires the owner role',
      });

      const deletedWorkspace = await db.transaction(async (tx) => {
        // Cross-workspace deletion serializes destination selection for every device.
        await tx.execute(sql`select pg_advisory_xact_lock(6, 0)`);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 5))`);
        await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update');
        const actor = (
          await tx
            .select({ role: member.role })
            .from(member)
            .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
        ).at(0);
        if (!actor || actor.role !== 'owner')
          throw new AppError('FORBIDDEN', 'Workspace deletion requires a current owner', {
            organizationId,
          });
        const ws = (
          await tx
            .select()
            .from(workspace)
            .where(eq(workspace.organizationId, organizationId))
            .for('update')
        ).at(0);
        if (!ws)
          throw new AppError('WORKSPACE_NOT_FOUND', 'Workspace deletion target is missing', {
            organizationId,
          });
        if (ws.id !== parsed.data.workspaceId)
          throw new AppError('WORKSPACE_CHANGED', 'Workspace selection changed before deletion', {
            expectedState: true,
            workspaceId: parsed.data.workspaceId,
          });
        if (parsed.data.confirmName.trim() !== ws.name.trim())
          throw new AppError('VALIDATION_FAILED', 'Confirmation name does not match', {
            organizationId,
          });
        if (ws.lifecycleStatus !== 'live') return ws;
        const next = (
          await tx
            .select({ id: workspace.id })
            .from(member)
            .innerJoin(
              workspace,
              and(eq(workspace.organizationId, member.organizationId), workspaceNotDeleted),
            )
            .where(and(eq(member.userId, userId), ne(member.organizationId, organizationId)))
            .limit(1)
        ).at(0);
        if (!next)
          throw new AppError('LAST_WORKSPACE_BLOCKED', 'Cannot delete your only workspace', {
            organizationId,
          });
        const moved = await claimWorkspaceDeletion(tx, ws.id, new Date());
        if (!moved)
          throw new AppError('CONFLICT', 'Workspace deletion lost its claim', { organizationId });
        await evacuateOrganizationSessions(tx, organizationId, null);
        return ws;
      });
      const snapshot = snapshotCtx();
      after(() =>
        withRequestContext(snapshot, async () => {
          try {
            await finishDeletingWorkspaces(sweepDeadline(), {
              kind: 'workspaces',
              ids: [deletedWorkspace.id],
            });
          } catch (error) {
            captureException(error, {
              op: 'workspace-deletion-provider-cleanup',
              workspaceId: deletedWorkspace.id,
            });
          }
        }),
      );

      return 'DELETED' as const;
    },
  );
}
