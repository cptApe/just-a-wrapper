import 'server-only';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/db';
import { member, task, workspace, workspaceNotDeleted } from '@/db/schema';
import { captureException } from '@/lib/observability';
import { recoverRows } from '@/lib/recover-rows';
import { snapshotCtx, withRequestContext } from '@/lib/request-context';
import { sweepDeadline } from '@/lib/sweep-deadline';
import { syncTaskProvider } from './sync-task-provider';
import { markDefinitionDrift } from './task-transitions';

// A deployment snapshots its creator's name, time zone and reply language. A saved change reaches
// every live schedule the person created at once; the daily snapshot sweep stays the fallback.

/** Marks each live schedule the person created as changed and pushes it to the provider. */
export async function syncCreatorTasks(userId: string): Promise<void> {
  const rows = await db
    .select({ id: task.id })
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
        eq(task.createdByUserId, userId),
        eq(task.triggerType, 'schedule'),
        inArray(task.status, ['upcoming', 'paused']),
        isNotNull(task.anthropicDeploymentId),
      ),
    );
  await recoverRows(
    rows,
    async ({ id }) => {
      await markDefinitionDrift(id);
      await syncTaskProvider(id);
    },
    { deadline: sweepDeadline() },
  );
}

/** Runs `syncCreatorTasks` after the response, so a save never waits on the provider. */
export function scheduleCreatorTaskSync(userId: string): void {
  const snapshot = snapshotCtx();
  after(() =>
    withRequestContext(snapshot, async () => {
      try {
        await syncCreatorTasks(userId);
      } catch (error) {
        // The drift mark stays on any row that did not push, so the daily sweep finishes it.
        captureException(error, { feature: 'tasks', op: 'creator-task-sync', userId });
      }
    }),
  );
}
