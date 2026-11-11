import { and, eq, inArray, lt, or } from 'drizzle-orm';
import { type DbTransaction, db } from '@/db';
import { workspace } from '@/db/schema';
import { workspaceLifecycleMachine } from '../lib/workspace-lifecycle-machine';

export async function claimWorkspaceDeletion(tx: DbTransaction, workspaceId: string, now: Date) {
  const moved = await tx
    .update(workspace)
    .set({ lifecycleStatus: 'deleting', deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(workspace.id, workspaceId),
        inArray(workspace.lifecycleStatus, workspaceLifecycleMachine.sourcesOf('deleting')),
      ),
    )
    .returning({ id: workspace.id });
  return moved.length === 1;
}

export async function finishWorkspaceDeletion(workspaceId: string) {
  const moved = await db
    .update(workspace)
    .set({ lifecycleStatus: 'deleted', updatedAt: new Date() })
    .where(
      and(
        eq(workspace.id, workspaceId),
        inArray(workspace.lifecycleStatus, workspaceLifecycleMachine.sourcesOf('deleted')),
      ),
    )
    .returning({ id: workspace.id });
  return moved.length === 1;
}

export async function claimWorkspacePurge(workspaceId: string, cutoff: Date) {
  const claimedAt = new Date();
  const moved = await db
    .update(workspace)
    .set({ lifecycleStatus: 'purging', updatedAt: claimedAt })
    .where(
      and(
        eq(workspace.id, workspaceId),
        lt(workspace.deletedAt, cutoff),
        inArray(workspace.lifecycleStatus, workspaceLifecycleMachine.sourcesOf('purging')),
        or(
          eq(workspace.lifecycleStatus, 'deleted'),
          lt(workspace.updatedAt, new Date(Date.now() - 600_000)),
        ),
      ),
    )
    .returning({ id: workspace.id });
  return moved.length === 1 ? claimedAt : null;
}

export async function finishWorkspacePurge(
  tx: DbTransaction,
  workspaceId: string,
  claimedAt: Date,
) {
  const moved = await tx
    .delete(workspace)
    .where(
      and(
        eq(workspace.id, workspaceId),
        eq(workspace.updatedAt, claimedAt),
        inArray(workspace.lifecycleStatus, ['purging']),
      ),
    )
    .returning({ id: workspace.id });
  return moved.length === 1;
}

// Rotates the sweep order so one failing workspace cannot starve the rest.
export async function recordWorkspacePurgeAttempt(workspaceId: string) {
  await db
    .update(workspace)
    .set({ purgeAttemptedAt: new Date() })
    .where(eq(workspace.id, workspaceId));
}
