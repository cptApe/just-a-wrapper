import { and, eq, inArray, lt, or } from 'drizzle-orm';
import { type DbTransaction, db } from '@/db';
import { integration, integrationCleanup, workspace, workspaceMember } from '@/db/schema';
import { capabilities } from '@/lib/runtime-capabilities';
import { memberCleanupMachine } from '../lib/member-cleanup-machine';
import { revokeSharesByMember } from './shared-connection-transitions';

export async function enqueueMemberCleanup(
  tx: DbTransaction,
  input: {
    composioUserId: string;
    vaultId: string | null;
    memoryStoreId: string | null;
  },
): Promise<void> {
  await revokeSharesByMember(tx, input.composioUserId);
  const accounts = await tx
    .select({ id: integration.id })
    .from(integration)
    .innerJoin(workspace, eq(workspace.id, integration.workspaceId))
    .innerJoin(
      workspaceMember,
      and(
        eq(workspaceMember.organizationId, workspace.organizationId),
        eq(workspaceMember.userId, integration.userId),
      ),
    )
    .where(eq(workspaceMember.composioUserId, input.composioUserId))
    .limit(1);
  await tx
    .insert(integrationCleanup)
    .values({
      ...input,
      requiresComposio: capabilities.connectedApps.kind === 'composio' || accounts.length > 0,
    })
    .onConflictDoNothing();
}

export async function claimMemberCleanup(composioUserId: string, now: Date) {
  const rows = await db
    .update(integrationCleanup)
    .set({ status: 'working', claimedAt: now, purgeAttemptedAt: now })
    .where(
      and(
        eq(integrationCleanup.composioUserId, composioUserId),
        inArray(integrationCleanup.status, memberCleanupMachine.sourcesOf('working')),
        or(
          eq(integrationCleanup.status, 'pending'),
          lt(integrationCleanup.claimedAt, new Date(now.getTime() - 300_000)),
        ),
      ),
    )
    .returning();
  return rows.at(0) ?? null;
}

type CleanupClaim = { composioUserId: string; claimedAt: Date };

export async function releaseMemberCleanup(input: CleanupClaim): Promise<boolean> {
  const rows = await db
    .update(integrationCleanup)
    .set({ status: 'pending', claimedAt: null })
    .where(
      and(
        eq(integrationCleanup.composioUserId, input.composioUserId),
        inArray(integrationCleanup.status, memberCleanupMachine.sourcesOf('pending')),
        eq(integrationCleanup.claimedAt, input.claimedAt),
      ),
    )
    .returning({ id: integrationCleanup.composioUserId });
  return rows.length > 0;
}

export async function deleteMemberCleanup(input: CleanupClaim): Promise<boolean> {
  const rows = await db
    .delete(integrationCleanup)
    .where(
      and(
        eq(integrationCleanup.composioUserId, input.composioUserId),
        eq(integrationCleanup.status, 'working'),
        eq(integrationCleanup.claimedAt, input.claimedAt),
      ),
    )
    .returning({ id: integrationCleanup.composioUserId });
  return rows.length > 0;
}
