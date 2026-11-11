import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import {
  file,
  folder,
  folderShare,
  integration,
  session,
  sessionShare,
  workspace,
  workspaceMember,
} from '@/db/schema';
import { revokeShares } from '@/features/files/api/share-transitions';
import { transitionFiles, transitionFolders } from '@/features/files/api/trash-transitions';
import { enqueueMemberCleanup } from '@/features/integrations/api/member-cleanup-transitions';
import { hideSessionTransition } from '@/features/sessions/api/session-transitions';
import { revokeLiveShares } from '@/features/sessions/api/share-transitions';
import { cancelMemberTasks } from '@/features/tasks/api/task-transitions';
import { evacuateOrganizationSessions } from './active-organization-transitions';
export async function revokeMemberWorkspaceAccess(
  tx: DbTransaction,
  organizationId: string,
  userId: string,
) {
  const provision = (
    await tx
      .select()
      .from(workspaceMember)
      .where(
        and(eq(workspaceMember.organizationId, organizationId), eq(workspaceMember.userId, userId)),
      )
  ).at(0);
  if (provision)
    await enqueueMemberCleanup(tx, {
      composioUserId: provision.composioUserId,
      vaultId: provision.mcpProxyVaultId,
      memoryStoreId: provision.userMemoryStoreId,
    });
  await evacuateOrganizationSessions(tx, organizationId, userId);
  const ownedWorkspace = (
    await tx
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.organizationId, organizationId))
  ).at(0);
  if (ownedWorkspace) {
    await revokeShares(
      tx,
      and(eq(folderShare.workspaceId, ownedWorkspace.id), eq(folderShare.createdByUserId, userId)),
    );
    await revokeLiveShares(
      tx,
      and(
        eq(sessionShare.workspaceId, ownedWorkspace.id),
        eq(sessionShare.createdByUserId, userId),
      ),
      { expiredOnly: false },
    );
    if (provision?.browserbaseContextId) {
      await tx
        .update(workspace)
        .set({
          browserContextCleanupIds: sql`array_append(${workspace.browserContextCleanupIds}, ${provision.browserbaseContextId})`,
        })
        .where(eq(workspace.id, ownedWorkspace.id));
    }
    const now = new Date();
    await transitionFiles(
      tx,
      and(
        eq(file.workspaceId, ownedWorkspace.id),
        eq(file.createdByUserId, userId),
        sql`${file.folderPath} <> '/Team' and ${file.folderPath} not like '/Team/%'`,
      ),
      now,
    );
    await transitionFolders(
      tx,
      and(
        eq(folder.workspaceId, ownedWorkspace.id),
        eq(folder.createdByUserId, userId),
        sql`${folder.path} <> '/Team' and ${folder.path} not like '/Team/%' and ${folder.path} <> '/Chat uploads'`,
        sql`not exists (select 1 from ${file} where ${file.workspaceId} = ${folder.workspaceId}
          and ${file.deletedAt} is null and ${file.createdByUserId} <> ${userId}
          and (${file.folderPath} = ${folder.path} or starts_with(${file.folderPath}, ${folder.path} || '/')))`,
      ),
      now,
    );
    await cancelMemberTasks(tx, ownedWorkspace.id, userId);
    await hideSessionTransition(
      tx,
      and(
        eq(session.workspaceId, ownedWorkspace.id),
        eq(session.createdByUserId, userId),
        eq(session.kind, 'task_run'),
        inArray(session.status, [
          'creating',
          'creation_cleanup',
          'awaiting_opening',
          'opening',
          'running',
          'requires_input',
          'rescheduling',
          'pausing',
          'paused_no_credits',
          'resuming',
        ]),
      ),
    );
    await tx
      .delete(integration)
      .where(and(eq(integration.workspaceId, ownedWorkspace.id), eq(integration.userId, userId)));
  }

  await tx
    .delete(workspaceMember)
    .where(
      and(eq(workspaceMember.organizationId, organizationId), eq(workspaceMember.userId, userId)),
    );
}
