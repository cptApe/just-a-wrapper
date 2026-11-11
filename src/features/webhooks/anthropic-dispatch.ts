import { pauseSessionForBudgetReached } from '@/features/billing/api/pause-session-on-exhaustion';
import { reconcileSessionUsage } from '@/features/billing/api/reconcile-session-usage';
import { sweepSessionArtifacts } from '@/features/files/api/sweep-session-artifacts';
import { notifyVaultCredentialRefreshFailed } from '@/features/notifications/api/notify-vault-credential-refresh-failed';
import { syncSessionStatus } from '@/features/sessions/api/sync-session-status';
import { adoptTaskRunBySessionId } from '@/features/tasks/api/adopt-task-run';
import {
  completeDeploymentRunFailure,
  completeTaskRun,
} from '@/features/tasks/api/complete-task-run';
import { recordTaskRunReview } from '@/features/tasks/api/record-task-run-review';
import { mirrorDeploymentState } from '@/features/tasks/api/task-lifecycle';
import { dispatchSessionActions } from '@/features/tools/api/dispatch-session-actions';
import { WebhookError } from '@/lib/errors';
import { shipLog } from '@/lib/logger';
import { extend } from '@/lib/request-context';

export type DispatchableAnthropicEvent = {
  id: string;
  created_at: string;
  type: 'event';
  data: {
    type: string;
    id: string;
    organization_id: string;
    workspace_id: string;
    vault_id?: unknown;
  };
};

export async function routeAnthropicEvent(event: DispatchableAnthropicEvent): Promise<void> {
  const { type, id, workspace_id, organization_id } = event.data;
  extend({ workspace_id, organization_id });

  switch (type) {
    case 'session.status_run_started':
      return handleRunStarted(event);
    case 'session.status_idled':
      return handleSessionIdled(event);
    case 'session.status_terminated':
      return handleSessionTerminated(event);
    case 'session.outcome_evaluation_ended':
      return handleOutcomeEvaluated(event);
    case 'deployment_run.failed': {
      await completeDeploymentRunFailure({
        anthropicDeploymentRunId: id,
        webhookEventId: event.id,
        occurredAt: event.created_at,
      });
      return;
    }
    case 'deployment.paused':
    case 'deployment.unpaused': {
      await mirrorDeploymentState({
        anthropicDeploymentId: id,
        webhookEventId: event.id,
      });
      return;
    }
    case 'vault_credential.refresh_failed':
      return handleCredentialRefreshFailure(event);
    case 'session.budget_reached': {
      const sessionId = id;
      extend({ session_id: sessionId });
      await adoptTaskRunBySessionId(sessionId);
      await pauseSessionForBudgetReached({
        anthropicSessionId: sessionId,
        webhookEventId: event.id,
      });
      return;
    }
    default: {
      shipLog({
        msg: 'webhook.event.ignored',
        feature: 'webhooks',
        op: 'anthropic.ignored',
        event_id: event.id,
        event_type: type,
      });
    }
  }
}

async function handleRunStarted(event: DispatchableAnthropicEvent): Promise<void> {
  const { id } = event.data;
  const sessionId = id;
  extend({ session_id: sessionId });
  const outcome = await adoptTaskRunBySessionId(sessionId);
  shipLog({
    msg: 'webhook.session.status_run_started',
    feature: 'webhooks',
    op: 'anthropic.session_status_run_started',
    event_id: event.id,
    session_id: sessionId,
    adopted: outcome?.adopted ?? false,
  });
  return;
}

async function handleSessionIdled(event: DispatchableAnthropicEvent): Promise<void> {
  const { id } = event.data;
  const sessionId = id;
  extend({ session_id: sessionId });
  await adoptTaskRunBySessionId(sessionId);
  const current = await syncSessionStatus({
    kind: 'reconcile',
    anthropicSessionId: sessionId,
    allowFromPause: false,
  });
  const finished =
    current?.status === 'idle' &&
    (current.stopReason === 'end_turn' ||
      current.stopReason === 'interrupted' ||
      current.stopReason === 'retries_exhausted');
  // Each job is idempotent, so a failure fails the delivery for a retry without holding up the
  // others. Tool dispatch goes first so an agent waiting on a tool resumes at once.
  await runIndependentJobs({
    tools:
      current?.stopReason === 'requires_action' ? dispatchSessionActions(sessionId) : undefined,
    'task-run': finished
      ? completeTaskRun({
          anthropicSessionId: sessionId,
          outcome: current.stopReason === 'end_turn' ? 'idle' : 'terminated',
          webhookEventId: event.id,
        })
      : undefined,
    // Accrual's event id and container-seconds high-water guards make a redelivered retry safe.
    usage: reconcileSessionUsage(sessionId, Date.now() + 180_000),
    // Files API indexing can lag the webhook, so the webhook-settle profile polls briefly.
    artifacts: sweepSessionArtifacts({ anthropicSessionId: sessionId, profile: 'webhook-settle' }),
  });
}

async function runIndependentJobs(jobs: Record<string, Promise<unknown> | undefined>) {
  const started = Object.entries(jobs).flatMap(([name, job]) => (job ? [{ name, job }] : []));
  const outcomes = await Promise.allSettled(started.map(({ job }) => job));
  const failed = started.filter((_, index) => outcomes[index]?.status === 'rejected');
  if (failed.length === 0) return;
  throw new WebhookError(
    'UNEXPECTED',
    'Session idle follow-up jobs failed',
    { failed: failed.map(({ name }) => name) },
    {
      cause: new AggregateError(
        outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : [])),
      ),
    },
  );
}

async function handleSessionTerminated(event: DispatchableAnthropicEvent): Promise<void> {
  const { id } = event.data;
  const sessionId = id;
  extend({ session_id: sessionId });
  await adoptTaskRunBySessionId(sessionId);
  const completion = await completeTaskRun({
    anthropicSessionId: sessionId,
    outcome: 'terminated',
    webhookEventId: event.id,
  });
  shipLog({
    level: 'error',
    msg: 'webhook.session.terminated',
    feature: 'webhooks',
    op: 'anthropic.session_terminated',
    event_id: event.id,
    session_id: sessionId,
    task_id: completion.taskId,
  });
  await syncSessionStatus({
    kind: 'reconcile',
    anthropicSessionId: sessionId,
    allowFromPause: true,
  });
  await reconcileSessionUsage(sessionId, Date.now() + 180_000);
  return;
}

async function handleOutcomeEvaluated(event: DispatchableAnthropicEvent): Promise<void> {
  const { id } = event.data;
  const sessionId = id;
  extend({ session_id: sessionId });
  const review = await recordTaskRunReview({
    anthropicSessionId: sessionId,
    webhookEventId: event.id,
  });
  shipLog({
    msg: 'webhook.session.outcome_evaluation_ended',
    feature: 'webhooks',
    op: 'anthropic.outcome_evaluation_ended',
    event_id: event.id,
    session_id: sessionId,
    handled: review.handled,
    review_outcome: review.handled ? review.reviewOutcome : null,
    ignored_reason: review.handled ? null : review.reason,
  });
  return;
}

async function handleCredentialRefreshFailure(event: DispatchableAnthropicEvent): Promise<void> {
  const { id } = event.data;
  if (typeof event.data.vault_id !== 'string' || event.data.vault_id.length === 0) {
    shipLog({
      level: 'warn',
      msg: 'webhook.vault_credential.refresh_failed.ignored',
      feature: 'webhooks',
      op: 'anthropic.vault_credential_refresh_failed',
      event_id: event.id,
      credential_id: id,
      reason: 'missing_vault_id',
    });
    return;
  }
  await notifyVaultCredentialRefreshFailed({
    credentialId: id,
    vaultId: event.data.vault_id,
    webhookEventId: event.id,
  });
  return;
}
