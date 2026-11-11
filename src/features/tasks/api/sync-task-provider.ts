import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspace } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { composioCapability } from '@/lib/runtime-capabilities';
import { deleteTriggerInstance, setTriggerInstanceStatus } from './composio-triggers';
import { type DeploymentPush, pushTaskDeployment } from './task-deployments';
import {
  claimProviderSync,
  finishProviderSync,
  releaseProviderSync,
  removeUnavailableTask,
  type TaskRow,
} from './task-transitions';

// The app row is the truth; this makes the provider match it (decision 0035). The row's
// provider_sync mark survives a crash, so the recovery sweep finishes whatever a request began.

export type SyncResult = 'synced' | 'pending' | 'one_off_mismatch' | 'removed';

const MAX_PASSES = 3;

export async function syncTaskProvider(taskId: string): Promise<SyncResult> {
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const claim = await claimProviderSync(taskId);
    // Nothing to push, or another worker holds the lease and will see every newer version.
    if (!claim) return 'pending';
    let push: DeploymentPush;
    try {
      push = await pushTask(claim);
    } catch (error) {
      await releaseProviderSync(claim);
      throw error;
    }
    if (push.kind === 'gone') {
      if (await removeUnavailableTask(claim.id)) return 'removed';
      await releaseProviderSync(claim);
      continue;
    }
    if (push.kind === 'one_off_mismatch') {
      if (await finishProviderSync({ claim, move: 'paused' })) return 'one_off_mismatch';
      continue;
    }
    const settled = await finishProviderSync({
      claim,
      nextRunAt: push.nextRunAt,
      snapshotHash: push.snapshotHash,
    });
    if (settled) return 'synced';
  }
  // A newer write keeps the mark; the sweep picks it up.
  return 'pending';
}

async function pushTask(row: TaskRow): Promise<DeploymentPush> {
  if (row.triggerType === 'event') return pushTrigger(row);
  const owner = (
    await db
      .select({ organizationId: workspace.organizationId })
      .from(workspace)
      .where(eq(workspace.id, row.workspaceId))
      .limit(1)
  ).at(0);
  if (!owner)
    throw new AppError('WORKSPACE_NOT_FOUND', 'Task workspace is missing', { taskId: row.id });
  return pushTaskDeployment(row, owner.organizationId);
}

// Event definitions live only in the row; the trigger instance follows the status.
async function pushTrigger(row: TaskRow): Promise<DeploymentPush> {
  if (!row.composioTriggerId) return { kind: 'synced', nextRunAt: null };
  const { apiKey } = composioCapability();
  if (row.status === 'removed') {
    await deleteTriggerInstance(apiKey, row.composioTriggerId);
    return { kind: 'synced', nextRunAt: null };
  }
  if (row.status !== 'upcoming' && row.status !== 'paused')
    return { kind: 'synced', nextRunAt: null };
  const outcome = await setTriggerInstanceStatus(
    apiKey,
    row.composioTriggerId,
    row.status === 'paused' ? 'disable' : 'enable',
  );
  return outcome === 'missing' ? { kind: 'gone' } : { kind: 'synced', nextRunAt: null };
}

/** The command is durable once the row moved; a provider failure is left to the sync sweep. */
export async function syncOrLeaveForSweep(taskId: string): Promise<SyncResult> {
  try {
    return await syncTaskProvider(taskId);
  } catch (error) {
    captureException(error, { feature: 'tasks', op: 'sync-provider-deferred', taskId });
    return 'pending';
  }
}
