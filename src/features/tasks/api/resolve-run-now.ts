import 'server-only';
import { and, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { task } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { collectRecoveryFailures } from '@/lib/recover-rows';
import { adoptTaskRunSession } from './adopt-task-run';
import { findManualRuns } from './task-deployments';
import { releaseRunNow } from './task-transitions';

// A run-now whose answer was lost is settled from the provider's run log: a recorded run, with a
// session or an error, ends the lease. No record after the grace means the request never started one.
const SETTLE_AFTER_MS = 2 * 60_000;
const NO_RECORD_GRACE_MS = 10 * 60_000;

export async function resolveRunNowLeases(deadline: number): Promise<unknown[]> {
  const rows = await db
    .select({
      id: task.id,
      deploymentId: task.anthropicDeploymentId,
      claimedAt: task.runNowClaimedAt,
    })
    .from(task)
    .where(
      and(
        isNotNull(task.runNowClaimedAt),
        lt(task.runNowClaimedAt, new Date(Date.now() - SETTLE_AFTER_MS)),
      ),
    )
    .orderBy(sql`${task.runNowClaimedAt} asc`)
    .limit(25);
  return collectRecoveryFailures(
    rows,
    async (row) => {
      if (row.claimedAt === null) return;
      if (row.deploymentId === null) return releaseRunNow(row.id, row.claimedAt);
      const runs = await findManualRuns(row.deploymentId, row.claimedAt);
      for (const run of runs)
        if (run.session_id)
          await adoptTaskRunSession(
            await requireAnthropicClient().beta.sessions.retrieve(
              run.session_id,
              {},
              { timeout: 30_000 },
            ),
          );
      if (runs.length > 0 || Date.now() - row.claimedAt.getTime() >= NO_RECORD_GRACE_MS)
        await releaseRunNow(row.id, row.claimedAt);
    },
    { deadline },
  );
}
