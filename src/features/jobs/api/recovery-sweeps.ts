import 'server-only';
import { retryNotificationEmails } from '@/features/notifications/api/retry-notification-emails';
import { reconcileAllSessions } from '@/features/session-runtime/api/reconcile-stale-sessions';
import { runAfterResponse } from '@/features/sessions/api/create-background-work';
import { sweepSessionSends } from '@/features/sessions/api/session-send-transitions';
import { dispatchSessionActions } from '@/features/tools/api/dispatch-session-actions';
import { AppError } from '@/lib/errors';
import { DurableRecoveryError, settleRecoveryOperations } from '@/lib/recover-rows';
import { sweepDeadline } from '@/lib/sweep-deadline';

/** At most one sweep per server instance per window — the trigger sits on the
    sidebar's first-page load, which fires on every shell navigation. */
const SWEEP_COOLDOWN_MS = 5 * 60_000;
let lastSweepStartedAt = 0;

// Run sweeps after the response so frequent sidebar reads do not wait on upstream lookups; the
// cooldown bounds their cost.
export function scheduleStaleSessionSweep(): void {
  const now = Date.now();
  if (now - lastSweepStartedAt < SWEEP_COOLDOWN_MS) return;
  runAfterResponse('stale-session-sweep', { scope: 'stale-session-sweep' }, async () => {
    try {
      await runRecoverySweeps();
    } catch (error) {
      if (!(error instanceof DurableRecoveryError) && lastSweepStartedAt === now)
        lastSweepStartedAt = 0;
      throw error;
    }
  });
  lastSweepStartedAt = now;
}

export async function runRecoverySweeps() {
  const { reconcileTimedOutBrowserSessions } = await import('@/features/tools/api/browser-timeout');
  const { reconcileTaskState } = await import('@/features/tasks/api/reconcile-task-state');
  const { reconcileDeploymentSnapshots } = await import(
    '@/features/tasks/api/reconcile-deployment-snapshots'
  );
  const { drainMemberCleanups } = await import('@/features/integrations/api/member-cleanup');
  const { recoverRemovedCreatorTools } = await import(
    '@/features/tools/api/recover-removed-creator-tools'
  );
  return settleRecoveryOperations([
    recoverRemovedCreatorTools(sweepDeadline()),
    reconcileAllSessions(dispatchSessionActions),
    reconcileTimedOutBrowserSessions(),
    reconcileTaskState(),
    sweepSessionSends(),
    retryNotificationEmails(),
    reconcileDeploymentSnapshots(),
    drainMemberCleanups({ kind: 'backlog' }).then((report) => {
      if (report.failed > 0)
        throw new DurableRecoveryError([
          new AppError('EXTERNAL_API_FAILED', 'Member cleanup has unfinished operations', {
            failed: report.failed,
          }),
        ]);
    }),
  ]);
}
