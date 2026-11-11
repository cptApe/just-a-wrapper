import 'server-only';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { member, task, workspace, workspaceNotDeleted } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { recoverRows } from '@/lib/recover-rows';
import { sweepDeadline } from '@/lib/sweep-deadline';
import { deploymentFingerprint } from './deployment-fingerprint';
import { syncTaskProvider } from './sync-task-provider';
import { markDefinitionDrift, type TaskRow } from './task-transitions';

// A deployment snapshots its agent, skills, instructions and the creator's name, time zone and
// language. Checks rotate through every live schedule, so drift from any source is found.
export async function reconcileDeploymentSnapshots(): Promise<void> {
  const candidates = await db
    .select({ task })
    .from(task)
    .innerJoin(workspace, and(eq(workspace.id, task.workspaceId), workspaceNotDeleted))
    .innerJoin(
      member,
      and(
        eq(member.organizationId, workspace.organizationId),
        eq(member.userId, task.createdByUserId),
      ),
    )
    .where(
      and(
        eq(task.triggerType, 'schedule'),
        inArray(task.status, ['upcoming', 'paused']),
        isNotNull(task.anthropicDeploymentId),
      ),
    )
    .orderBy(sql`${task.deploymentCheckedAt} asc nulls first`, task.id)
    .limit(25);
  await recoverRows(candidates, (candidate) => refreshSnapshot(candidate.task), {
    deadline: sweepDeadline(),
  });
}

async function refreshSnapshot(row: TaskRow): Promise<void> {
  await db.update(task).set({ deploymentCheckedAt: new Date() }).where(eq(task.id, row.id));
  const hash = await deploymentFingerprint(requireAnthropicClient(), row);
  if (hash === row.deploymentSnapshotHash && row.providerSync === 'synced') return;
  await markDefinitionDrift(row.id);
  await syncTaskProvider(row.id);
}
