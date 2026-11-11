import { purgeRateLimits } from '@/features/auth/api/purge-rate-limits';
import { drainMemberCleanups } from '@/features/integrations/api/member-cleanup';
import { recoverConnectionDisconnects } from '@/features/integrations/api/recover-connection-disconnects';
import { purgeExpiredRealtimeRows } from '@/features/realtime/api/purge';
import { captureException } from '@/lib/observability';
import { purgeExpired } from './purge-expired';

function jobReport<T>(
  job: string,
  outcome: PromiseSettledResult<T>,
  hasFailures: (report: T) => boolean,
) {
  if (outcome.status === 'fulfilled')
    return {
      status: hasFailures(outcome.value) ? ('failed' as const) : ('completed' as const),
      report: outcome.value,
    };
  captureException(outcome.reason, { feature: 'workspaces', op: 'purge-job', job });
  return {
    status: 'failed' as const,
    error: { code: 'UNEXPECTED', message: `${job} purge failed` },
  };
}

export async function runPurgeJobs({ dryRun }: { dryRun: boolean }) {
  const [realtime, workspaces, accessCleanup, disconnects, rateLimits] = await Promise.allSettled([
    purgeExpiredRealtimeRows({ dryRun }),
    purgeExpired({ dryRun }),
    dryRun
      ? Promise.resolve({ completed: 0, failed: 0 })
      : drainMemberCleanups({ kind: 'backlog' }),
    dryRun ? Promise.resolve({ completed: 0, failed: 0 }) : recoverConnectionDisconnects(),
    purgeRateLimits({ dryRun }),
  ]);
  const report = {
    dryRun,
    rateLimits: jobReport('rate-limits', rateLimits, () => false),
    realtime: jobReport('realtime', realtime, () => false),
    workspaces: jobReport(
      'workspaces',
      workspaces,
      (value) =>
        [value.deleting, value.workspaces, value.memberlessOrgs, value.users].some(
          (sweep) => sweep.failed.length > 0,
        ) ||
        value.storedFiles.failed.length > 0 ||
        value.storedFiles.aborted ||
        value.storedFiles.sweepError !== null ||
        value.storedFiles.incompletePrefixes.length > 0,
    ),
    accessCleanup: jobReport('access-cleanup', accessCleanup, (value) => value.failed > 0),
    disconnects: jobReport('disconnects', disconnects, (value) => value.failed > 0),
  };
  return {
    report,
    failed: [
      report.realtime,
      report.workspaces,
      report.accessCleanup,
      report.disconnects,
      report.rateLimits,
    ].some((job) => job.status === 'failed'),
  };
}
