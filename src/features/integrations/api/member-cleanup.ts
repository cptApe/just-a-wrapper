import { APIError } from '@anthropic-ai/sdk';
import { inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { integrationCleanup } from '@/db/schema';
import { getAnthropicClient } from '@/features/agents';
import { IntegrationError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { capabilities } from '@/lib/runtime-capabilities';
import { assertBeforeDeadline, sweepDeadline } from '@/lib/sweep-deadline';
import { deleteMemberAccounts } from '../composio/delete-member-accounts';
import {
  claimMemberCleanup,
  deleteMemberCleanup,
  releaseMemberCleanup,
} from './member-cleanup-transitions';
import { listShareRemovals } from './shared-connection-transitions';
import { finishRemovingShare } from './shared-connections';

async function cleanResources(
  row: typeof integrationCleanup.$inferSelect,
  deadline: number,
): Promise<void> {
  if (row.requiresComposio) {
    const { connectedApps } = capabilities;
    if (connectedApps.kind === 'off')
      throw new IntegrationError(
        'INTEGRATION_NOT_CONNECTED',
        'Member account cleanup requires Composio',
        { composioUserId: row.composioUserId },
      );
    await deleteMemberAccounts(row.composioUserId, connectedApps.apiKey, deadline);
  }
  const client = getAnthropicClient();
  if ((row.vaultId !== null || row.memoryStoreId !== null) && client === null) {
    throw new IntegrationError(
      'INTEGRATION_NOT_CONNECTED',
      'Anthropic cleanup requires a configured client',
      { composioUserId: row.composioUserId },
    );
  }
  if (client === null) return;
  const { vaultId, memoryStoreId } = row;
  if (vaultId !== null) {
    try {
      await client.beta.vaults.archive(vaultId, undefined, { timeout: 10_000, maxRetries: 0 });
    } catch (cause) {
      if (!(cause instanceof APIError && cause.status === 404))
        throw new IntegrationError(
          'EXTERNAL_API_FAILED',
          'Member vault could not be archived',
          { composioUserId: row.composioUserId, vaultId },
          { cause },
        );
    }
  }
  const vaultIds = new Set<string>();
  // A process can die after creation but before persisting the returned vault ID.
  for await (const vault of client.beta.vaults.list(undefined, {
    timeout: 10_000,
    maxRetries: 0,
  })) {
    assertBeforeDeadline(deadline, 'Member vault discovery deadline reached; cleanup will retry', {
      composioUserId: row.composioUserId,
    });
    if (
      vault.id !== vaultId &&
      vault.archived_at === null &&
      vault.metadata.composio_user_id === row.composioUserId
    )
      vaultIds.add(vault.id);
  }
  for (const operation of [
    ...Array.from(
      vaultIds,
      (id) => () => client.beta.vaults.archive(id, undefined, { timeout: 10_000, maxRetries: 0 }),
    ),
    memoryStoreId === null
      ? null
      : () =>
          client.beta.memoryStores.delete(memoryStoreId, undefined, {
            timeout: 10_000,
            maxRetries: 0,
          }),
  ]) {
    if (operation === null) continue;
    assertBeforeDeadline(
      deadline,
      'Member cleanup deadline reached; pending resources will retry',
      { composioUserId: row.composioUserId },
    );
    try {
      await operation();
    } catch (cause) {
      if (cause instanceof APIError && cause.status === 404) continue;
      throw new IntegrationError(
        'EXTERNAL_API_FAILED',
        'Member external resources could not be removed',
        { composioUserId: row.composioUserId },
        { cause },
      );
    }
  }
}

// Stopped shares retry here until Composio confirms the account is gone.
async function drainShareRemovals(deadline: number): Promise<number> {
  const { connectedApps } = capabilities;
  if (connectedApps.kind === 'off') return 0;
  let failed = 0;
  for (const removal of await listShareRemovals(50)) {
    if (Date.now() >= deadline) break;
    try {
      await finishRemovingShare(removal, connectedApps.apiKey);
    } catch (error) {
      captureException(error, {
        feature: 'integrations',
        op: 'shared-connection-removal',
        workspaceId: removal.workspaceId,
        toolkit: removal.toolkit,
      });
      failed += 1;
    }
  }
  return failed;
}

export async function drainMemberCleanups(
  scope: { kind: 'backlog' } | { kind: 'members'; ids: string[] },
): Promise<{ completed: number; failed: number }> {
  if (scope.kind === 'members' && scope.ids.length === 0) return { completed: 0, failed: 0 };
  const deadline = sweepDeadline();
  const candidates = await db
    .select()
    .from(integrationCleanup)
    .where(
      scope.kind === 'members' ? inArray(integrationCleanup.composioUserId, scope.ids) : undefined,
    )
    .orderBy(
      sql`${integrationCleanup.purgeAttemptedAt} asc nulls first`,
      integrationCleanup.composioUserId,
    )
    .limit(50);
  const report = { completed: 0, failed: 0 };
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    const claimedAt = new Date();
    const claim = await claimMemberCleanup(candidate.composioUserId, claimedAt);
    if (claim === null) continue;
    try {
      await cleanResources(claim, deadline);
      if (
        await deleteMemberCleanup({
          composioUserId: claim.composioUserId,
          claimedAt,
        })
      )
        report.completed += 1;
    } catch (error) {
      await releaseMemberCleanup({
        composioUserId: claim.composioUserId,
        claimedAt,
      });
      captureException(error, {
        feature: 'integrations',
        op: 'member-cleanup',
        composioUserId: claim.composioUserId,
      });
      report.failed += 1;
    }
  }
  report.failed += await drainShareRemovals(deadline);
  return report;
}
