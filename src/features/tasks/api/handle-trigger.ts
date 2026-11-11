// Event runs use the task creator identity so vault, memory and permissions cannot change
// with the webhook caller.

import { notifyRefusedRun } from '@/features/billing/api/notify-refused-run';
import { startChatSession } from '@/features/session-runtime';
import { AppError, WebhookError } from '@/lib/errors';
import { shipLog } from '@/lib/logger';
import { extend } from '@/lib/request-context';
import 'server-only';
import { withAttachedFiles } from '../lib/task-attachments';
import type { TriggerDelivery, TriggerInput, TriggerOutcome } from '../types';
import { recoverTriggerDelivery } from './recover-trigger-delivery';
import {
  claimTriggerDelivery,
  recordTriggerDelivery,
  resumeTriggerDelivery,
} from './trigger-delivery-transitions';

// The kickoff message: the task's standing prompt, then the event that fired it.
// The payload is the agent's working data — pretty-printed, hard-capped so a
// pathological event can't blow the message budget.
const MAX_PAYLOAD_CHARS = 6000;

function buildKickoff(description: string, triggerSlug: string, payload: unknown): string {
  const serializedPayload = JSON.stringify(payload ?? {}, null, 2);
  const clipped =
    serializedPayload.length > MAX_PAYLOAD_CHARS
      ? `${serializedPayload.slice(0, MAX_PAYLOAD_CHARS)}\n… (truncated)`
      : serializedPayload;
  return `${description}\n\nTriggering event (${triggerSlug}):\n\`\`\`json\n${clipped}\n\`\`\``;
}

/** Claim the signed delivery before starting its non-idempotent remote run. */
export async function handleComposioTrigger(input: TriggerInput): Promise<TriggerOutcome> {
  if (!input.deliveryId) {
    throw new WebhookError('WEBHOOK_SIGNATURE_INVALID', 'Missing signed Composio delivery id');
  }
  const claim = await claimTriggerDelivery(input);
  shipLog({
    msg: 'composio_trigger.claim',
    feature: 'tasks',
    op: 'handle-trigger',
    delivery_id: input.deliveryId,
    trigger_id: input.triggerId,
    claim: claim.kind,
    ...(claim.kind === 'ignored' || claim.kind === 'refused' ? { reason: claim.reason } : {}),
  });
  if (claim.kind === 'ignored') return { handled: false, reason: claim.reason };
  if (claim.kind === 'refused') {
    await notifyRefusedRun({ ...claim, refusalKey: input.deliveryId });
    return { handled: false, reason: claim.reason };
  }
  if (claim.kind === 'repeat') {
    await recoverTriggerDelivery(input.deliveryId);
    return resumeTriggerDelivery(input.deliveryId);
  }

  const { task, organizationId } = claim;
  extend({ task_id: task.id, workspace_id: task.workspaceId });
  let delivery: TriggerDelivery = {
    state: 'creating',
    taskId: task.id,
    sessionId: claim.sessionId,
  };
  try {
    // The claim passed the spend gate; the session budget caps the run at the creator's allowance.
    // The shared session creator disables SDK retries for the non-idempotent upstream call.
    const { sessionId, anthropicSessionId } = await startChatSession({
      deferInitialMessage: false,
      tier: task.tier,
      message: buildKickoff(
        withAttachedFiles(task.description ?? task.title, task.attachments),
        input.triggerSlug,
        input.payload,
      ),
      title: task.title,
      workspaceId: task.workspaceId,
      createdByUserId: task.createdByUserId,
      organizationId,
      kind: 'task_run',
      taskRun: { taskId: task.id, sessionId: claim.sessionId, visibility: task.visibility },
      permissionMode: task.autoApprove ? 'auto' : 'ask',
    });
    delivery = {
      state: 'session_created',
      taskId: task.id,
      sessionId,
      anthropicSessionId,
      startedAt: new Date().toISOString(),
    };
    // Commit the ids BEFORE linking the task. A later transaction failure is
    // recoverable by redelivery, which only repairs local rows.
    const recorded = await recordTriggerDelivery(input.deliveryId, delivery);
    if (!recorded) return resumeTriggerDelivery(input.deliveryId);
  } catch (cause) {
    if (delivery.state === 'creating') {
      // The reserved ID locates durable ownership, including a failed creation awaiting cleanup.
      delivery = {
        state: 'ambiguous',
        taskId: task.id,
        errorCode: cause instanceof AppError ? cause.code : 'UNEXPECTED',
        sessionId: claim.sessionId,
      };
    }
    const error = new WebhookError(
      'UNEXPECTED',
      'Composio task start needs recovery',
      {
        delivery_id: input.deliveryId,
        ...delivery,
      },
      { cause },
    );
    // Persist known IDs before surfacing the failure. Recovery also finds the reserved app ID
    // in provider metadata when even this receipt write cannot commit.
    try {
      await recordTriggerDelivery(input.deliveryId, delivery);
    } catch (cause) {
      throw new WebhookError(
        'UNEXPECTED',
        'Trigger recovery receipt could not be saved',
        { deliveryId: input.deliveryId, sessionId: claim.sessionId },
        { cause },
      );
    }
    throw error;
  }

  return resumeTriggerDelivery(input.deliveryId);
}
