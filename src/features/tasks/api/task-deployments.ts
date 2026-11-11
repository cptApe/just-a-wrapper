import 'server-only';
import Anthropic, { APIError } from '@anthropic-ai/sdk';
import { requireAnthropicClient } from '@/features/agents';
import { AppError } from '@/lib/errors';
import { buildOneOffTransportCron } from '../lib/one-off-schedule';
import { buildTaskDeployment } from './build-task-deployment';
import { deploymentFingerprint } from './deployment-fingerprint';
import type { TaskRow } from './task-transitions';

// The one module that talks to Anthropic about a task's scheduled deployment (decision 0005).

type Deployment = Anthropic.Beta.BetaManagedAgentsDeployment;
const CALL = { timeout: 30_000 };

export function firstUpcomingRun(deployment: Pick<Deployment, 'schedule'>): Date | null {
  const next = deployment.schedule?.upcoming_runs_at?.[0];
  return next ? new Date(next) : null;
}

/** A definite refusal means nothing was created; anything else may have succeeded. */
export function isDefiniteRefusal(
  error: unknown,
  options: { rateLimitIsDefinite?: boolean } = {},
): boolean {
  const uncertain = options.rateLimitIsDefinite ? [408, 409] : [408, 409, 429];
  return (
    error instanceof APIError &&
    error.status !== undefined &&
    error.status >= 400 &&
    error.status < 500 &&
    !uncertain.includes(error.status)
  );
}

export function rejectedScheduleError(error: unknown, context: Record<string, unknown>) {
  if (!(error instanceof Anthropic.APIError && error.status === 400)) return null;
  return new AppError(
    'TOOL_INPUT_INVALID',
    `Anthropic rejected the schedule: ${error.message}`,
    context,
    { cause: error },
  );
}

function providerCron(row: Pick<TaskRow, 'cronSchedule' | 'runAt' | 'timezone'>): string {
  if (row.cronSchedule) return row.cronSchedule;
  if (!row.runAt || !row.timezone)
    throw new AppError('UNEXPECTED', 'Schedule task has no time', {});
  return buildOneOffTransportCron({
    runAt: row.runAt,
    timezone: row.timezone,
    now: new Date(),
    validateInstant: false,
  });
}

export async function createTaskDeployment(
  parameters: Awaited<ReturnType<typeof buildTaskDeployment>>,
  schedule: { expression: string; timezone: string },
  metadata: { task_id: string; workspace_id: string },
): Promise<Deployment> {
  // No retries: a lost response is found again through metadata, never created twice.
  return requireAnthropicClient().beta.deployments.create(
    { ...parameters, schedule: { type: 'cron', ...schedule }, metadata },
    { maxRetries: 0 },
  );
}

/** Deployments whose create response was lost carry the task id in their metadata. */
export async function findTaskDeployments(
  row: Pick<TaskRow, 'id' | 'createdAt'>,
): Promise<Deployment[]> {
  const found: Deployment[] = [];
  for await (const deployment of requireAnthropicClient().beta.deployments.list(
    { limit: 100, 'created_at[gte]': new Date(row.createdAt.getTime() - 60_000).toISOString() },
    CALL,
  )) {
    if (deployment.metadata.task_id === row.id) found.push(deployment);
  }
  return found;
}

export async function archiveDeployment(deploymentId: string): Promise<void> {
  const client = requireAnthropicClient();
  try {
    const deployment = await client.beta.deployments.retrieve(deploymentId, {}, CALL);
    if (!deployment.archived_at) await client.beta.deployments.archive(deploymentId, {}, CALL);
  } catch (error) {
    // A deleted deployment is already cleaned up.
    if (!(error instanceof APIError && error.status === 404)) throw error;
  }
}

export type DeploymentPush =
  | { kind: 'synced'; nextRunAt: Date | null; snapshotHash?: string }
  | { kind: 'gone' }
  | { kind: 'one_off_mismatch' };

/** Makes the deployment match the row: its definition when marked, and its status always. */
export async function pushTaskDeployment(
  row: TaskRow,
  organizationId: string,
): Promise<DeploymentPush> {
  if (row.status === 'removed' && row.anthropicDeploymentId === null) {
    for (const deployment of await findTaskDeployments(row))
      if (!deployment.archived_at) await archiveDeployment(deployment.id);
    return { kind: 'synced', nextRunAt: null };
  }
  if (row.anthropicDeploymentId === null) return { kind: 'synced', nextRunAt: row.nextRunAt };
  const deploymentId = row.anthropicDeploymentId;
  if (row.status !== 'upcoming' && row.status !== 'paused') {
    // A fired one-off, a finished one and a removed task keep no live deployment.
    await archiveDeployment(deploymentId);
    return { kind: 'synced', nextRunAt: null };
  }
  const client = requireAnthropicClient();
  let deployment: Deployment;
  let snapshotHash: string | undefined;
  try {
    deployment = await client.beta.deployments.retrieve(deploymentId, {}, CALL);
    if (deployment.archived_at) return { kind: 'gone' };
    if (row.providerSync === 'definition') {
      if (row.description === null || row.timezone === null)
        throw new AppError('VALIDATION_FAILED', 'Scheduled task has no prompt or timezone', {
          taskId: row.id,
        });
      const parameters = await buildTaskDeployment(client, {
        ...row,
        description: row.description,
        organizationId,
      });
      snapshotHash = await deploymentFingerprint(client, row);
      deployment = await client.beta.deployments.update(
        deploymentId,
        {
          ...parameters,
          schedule: { type: 'cron', expression: providerCron(row), timezone: row.timezone },
        },
        CALL,
      );
    }
  } catch (error) {
    // A missing deployment cannot be repaired; the task is removed instead of retried forever.
    if (error instanceof APIError && error.status === 404) return { kind: 'gone' };
    throw error;
  }
  if (row.status === 'paused') {
    if (deployment.status !== 'paused') await client.beta.deployments.pause(deploymentId, {}, CALL);
    return { kind: 'synced', nextRunAt: null, snapshotHash };
  }
  // An overdue one-off is never unpaused; run discovery records whether it ran, then removes it.
  if (row.runAt && row.runAt.getTime() <= Date.now())
    return { kind: 'synced', nextRunAt: row.runAt, snapshotHash };
  const next = firstUpcomingRun(deployment);
  if (row.runAt && next?.getTime() !== row.runAt.getTime()) {
    // The transport cron rolled past the one-off time; never let it fire a year late.
    if (deployment.status !== 'paused') await client.beta.deployments.pause(deploymentId, {}, CALL);
    return { kind: 'one_off_mismatch' };
  }
  if (deployment.status === 'paused')
    deployment = await client.beta.deployments.unpause(deploymentId, {}, CALL);
  return { kind: 'synced', nextRunAt: row.runAt ?? firstUpcomingRun(deployment), snapshotHash };
}

export async function retrieveDeployment(deploymentId: string): Promise<Deployment> {
  return requireAnthropicClient().beta.deployments.retrieve(deploymentId, {}, CALL);
}

/** Run now is not idempotent, so it is sent once and resolved later from the run log. */
export async function startDeploymentRun(deploymentId: string) {
  return requireAnthropicClient().beta.deployments.run(deploymentId, {}, { maxRetries: 0 });
}

export async function findManualRuns(deploymentId: string, since: Date) {
  const runs: Anthropic.Beta.BetaManagedAgentsDeploymentRun[] = [];
  for await (const run of requireAnthropicClient().beta.deploymentRuns.list(
    {
      deployment_id: deploymentId,
      trigger_type: 'manual',
      'created_at[gte]': new Date(since.getTime() - 60_000).toISOString(),
      limit: 20,
    },
    CALL,
  ))
    runs.push(run);
  return runs;
}

export function listDeploymentSessions(deploymentId: string, since: Date) {
  return requireAnthropicClient().beta.sessions.list(
    {
      deployment_id: deploymentId,
      include_archived: true,
      limit: 100,
      'created_at[gte]': since.toISOString(),
    },
    CALL,
  );
}
