import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { processedWebhookEvent, session, task, workspace } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { notificationChannels } from '@/features/notifications/lib/task-notification';
import { notify } from '@/features/notifications/server';
import { failSessionCreation, insertSession } from '@/features/sessions/api/session-transitions';
import { triggerDeliverySchema } from '../lib/trigger-delivery';
import { recordTriggerDelivery } from './trigger-delivery-transitions';

const CREATION_GRACE_MS = 5 * 60_000;

type UnresolvedDelivery = {
  deliveryId: string;
  processedAt: Date;
  taskId: string;
  sessionId: string;
};

export async function recoverTriggerDelivery(deliveryId: string): Promise<void> {
  const receipt = (
    await db
      .select()
      .from(processedWebhookEvent)
      .where(
        and(
          eq(processedWebhookEvent.provider, 'composio'),
          eq(processedWebhookEvent.eventId, deliveryId),
        ),
      )
      .limit(1)
  ).at(0);
  if (!receipt) return;
  const delivery = triggerDeliverySchema.parse(receipt.payload);
  if (delivery.state !== 'creating' && delivery.state !== 'ambiguous') return;
  if (!delivery.sessionId) {
    await failDelivery(deliveryId, delivery.taskId, 'MISSING_SESSION_ID');
    return;
  }
  const unresolved: UnresolvedDelivery = {
    deliveryId,
    processedAt: receipt.processedAt,
    taskId: delivery.taskId,
    sessionId: delivery.sessionId,
  };
  const local = (
    await db.select().from(session).where(eq(session.id, delivery.sessionId)).limit(1)
  ).at(0);
  if (local) {
    await settleFromLocalSession(unresolved, local);
    return;
  }
  // Allow an in-flight create to finish before scanning for an uncertain remote success.
  if (Date.now() - receipt.processedAt.getTime() < CREATION_GRACE_MS) return;
  await settleFromUpstream(unresolved);
}

async function settleFromLocalSession(
  unresolved: UnresolvedDelivery,
  local: typeof session.$inferSelect,
): Promise<void> {
  const { deliveryId, taskId } = unresolved;
  if (
    local.kind === 'task_run' &&
    local.status === 'awaiting_opening' &&
    Date.now() - local.statusChangedAt.getTime() >= CREATION_GRACE_MS
  ) {
    if (await failSessionCreation(db, local.id, local.anthropicSessionId, local.stateVersion))
      await failDelivery(deliveryId, taskId, 'OPENING_MESSAGE_MISSING');
    return;
  }
  // Failed creation belongs to the session cleanup sweep, which archives uncertain remote
  // successes. A provider ID alone does not prove the opening message was delivered.
  if (local.hiddenAt !== null || local.status === 'creation_cleanup') {
    if (Date.now() - unresolved.processedAt.getTime() >= CREATION_GRACE_MS)
      await failDelivery(deliveryId, taskId, 'SESSION_CREATION_FAILED');
    return;
  }
  if (
    local.status === 'creating' ||
    local.status === 'opening' ||
    local.status === 'awaiting_opening'
  )
    return;
  if (!local.anthropicSessionId) return;
  await recordTriggerDelivery(deliveryId, {
    state: 'session_created',
    taskId,
    sessionId: local.id,
    anthropicSessionId: local.anthropicSessionId,
    startedAt: local.createdAt.toISOString(),
  });
}

async function settleFromUpstream(unresolved: UnresolvedDelivery): Promise<void> {
  const { deliveryId, taskId, sessionId } = unresolved;
  const owner = (await db.select().from(task).where(eq(task.id, taskId)).limit(1)).at(0);
  if (!owner) {
    await failDelivery(deliveryId, taskId, 'TASK_NOT_FOUND');
    return;
  }
  const upstream = await findUpstreamSession(unresolved);
  if (!upstream) {
    await failDelivery(deliveryId, taskId, 'REMOTE_SESSION_NOT_FOUND');
    return;
  }
  if (upstream.archived_at !== null) {
    await failDelivery(deliveryId, taskId, 'REMOTE_SESSION_ARCHIVED');
    return;
  }
  const workspaceRow = (
    await db
      .select({ storeId: workspace.workspaceMemoryStoreId })
      .from(workspace)
      .where(eq(workspace.id, owner.workspaceId))
      .limit(1)
  ).at(0);
  const memoryMount = upstream.resources
    .filter((resource) => resource.type === 'memory_store')
    .find((resource) => resource.memory_store_id === workspaceRow?.storeId);
  await insertSession(db, {
    id: sessionId,
    workspaceMemoryAccess: memoryMount ? (memoryMount.access ?? 'read_write') : 'none',
    taskId: owner.id,
    kind: 'task_run',
    workspaceId: owner.workspaceId,
    createdByUserId: owner.createdByUserId,
    visibility: owner.visibility,
    tier: owner.tier,
    permissionMode: owner.autoApprove ? 'auto' : 'ask',
    anthropicSessionId: upstream.id,
    title: owner.title,
    status: upstream.status,
    startedAt: new Date(upstream.created_at),
    lastEventAt: new Date(upstream.created_at),
  });
  await recordTriggerDelivery(deliveryId, {
    state: 'session_created',
    taskId: owner.id,
    sessionId,
    anthropicSessionId: upstream.id,
    startedAt: upstream.created_at,
  });
}

async function findUpstreamSession({ processedAt, sessionId }: UnresolvedDelivery) {
  const client = requireAnthropicClient();
  for await (const upstream of client.beta.sessions.list(
    {
      'created_at[gte]': new Date(processedAt.getTime() - 60_000).toISOString(),
      include_archived: true,
      limit: 100,
    },
    { timeout: 30_000 },
  )) {
    if (upstream.metadata.app_session_id === sessionId) return upstream;
  }
  return null;
}

async function failDelivery(deliveryId: string, taskId: string, errorCode: string): Promise<void> {
  const moved = await recordTriggerDelivery(deliveryId, { state: 'failed', taskId, errorCode });
  if (!moved) return;
  const owner = (
    await db
      .select({ task, organizationId: workspace.organizationId })
      .from(task)
      .innerJoin(workspace, eq(task.workspaceId, workspace.id))
      .where(eq(task.id, taskId))
      .limit(1)
  ).at(0);
  if (!owner) return;
  const channels = notificationChannels(owner.task.notification);
  if (!channels.inApp && !channels.email) return;
  await notify('task.failed', {
    organizationId: owner.organizationId,
    recipientUserIds: [owner.task.createdByUserId],
    channels: { inApp: channels.inApp, email: channels.email ? 'force' : 'off' },
    idempotencyKey: `trigger-delivery-failed:${deliveryId}`,
    data: { title: 'Scheduled task failed', body: `${owner.task.title} could not start.` },
  });
}
