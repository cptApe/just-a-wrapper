import { randomUUID } from 'node:crypto';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { processedWebhookEvent, session, task, workspace, workspaceNotDeleted } from '@/db/schema';
import { checkSpend } from '@/features/billing/api/spend-gate';
import { WebhookError } from '@/lib/errors';
import { shipLog } from '@/lib/logger';
import 'server-only';
import { EVENT_TASK_MAX_LIVE_RUNS } from '../constants';
import { triggerDeliverySchema } from '../lib/trigger-delivery';
import { triggerDeliveryMachine } from '../lib/trigger-delivery-machine';
import type { TriggerDelivery, TriggerInput, TriggerOutcome } from '../types';
import { recordEventRunStart } from './task-transitions';

const deliveryWhere = (deliveryId: string) =>
  and(
    eq(processedWebhookEvent.provider, 'composio'),
    eq(processedWebhookEvent.eventId, deliveryId),
  );

function readDelivery(payload: unknown): TriggerDelivery {
  const parsed = triggerDeliverySchema.safeParse(payload);
  if (!parsed.success) {
    throw new WebhookError(
      'UNEXPECTED',
      'Invalid persisted Composio delivery',
      {},
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

export async function claimTriggerDelivery(input: TriggerInput) {
  return db.transaction(async (tx) => {
    // Serialize only the short claim transaction. Never hold a database lock
    // across remote create: its failure must not roll back the durable claim.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`composio:${input.deliveryId}`}, 0))`,
    );
    const existing = (
      await tx.select().from(processedWebhookEvent).where(deliveryWhere(input.deliveryId))
    ).at(0);
    if (existing) return { kind: 'repeat' as const };

    const owner = (
      await tx
        .select({ task, organizationId: workspace.organizationId })
        .from(task)
        .innerJoin(workspace, and(eq(task.workspaceId, workspace.id), workspaceNotDeleted))
        .where(eq(task.composioTriggerId, input.triggerId))
        .limit(1)
        .for('update', { of: task })
    ).at(0);
    if (!owner) return { kind: 'ignored' as const, reason: 'unknown_trigger' as const };
    if (owner.task.status !== 'upcoming') {
      return { kind: 'ignored' as const, reason: 'task_not_active' as const };
    }
    // The task row lock above serializes this count with every other claim for the task.
    if ((await liveRunCount(tx, owner.task.id)) >= EVENT_TASK_MAX_LIVE_RUNS) {
      const skipped: TriggerDelivery = {
        state: 'skipped',
        taskId: owner.task.id,
        reason: 'run_limit',
      };
      await tx.insert(processedWebhookEvent).values({
        provider: 'composio',
        eventId: input.deliveryId,
        eventType: input.triggerSlug,
        payload: skipped,
      });
      return { kind: 'ignored' as const, reason: 'run_limit' as const };
    }
    // A refused event run starts nothing and is recorded with the gate's reason.
    const refusal = await checkSpend(
      {
        entry: 'event_run',
        workspaceId: owner.task.workspaceId,
        userId: owner.task.createdByUserId,
      },
      tx,
    );
    if (refusal) {
      const skipped: TriggerDelivery = {
        state: 'skipped',
        taskId: owner.task.id,
        reason: refusal.reason,
      };
      await tx.insert(processedWebhookEvent).values({
        provider: 'composio',
        eventId: input.deliveryId,
        eventType: input.triggerSlug,
        payload: skipped,
      });
      return {
        kind: 'refused' as const,
        reason: refusal.reason,
        taskId: owner.task.id,
        organizationId: owner.organizationId,
      };
    }
    const delivery: TriggerDelivery = {
      state: 'creating',
      taskId: owner.task.id,
      sessionId: randomUUID(),
    };
    await tx.insert(processedWebhookEvent).values({
      provider: 'composio',
      eventId: input.deliveryId,
      eventType: input.triggerSlug,
      payload: delivery,
    });
    return { kind: 'start' as const, ...owner, sessionId: delivery.sessionId };
  });
}

// Runs still working count against the cap, including starts whose session row is not written yet.
async function liveRunCount(tx: Pick<typeof db, 'execute'>, taskId: string): Promise<number> {
  const live = sql.join(
    LIVE_RUN_STATUSES.map((status) => sql`${status}`),
    sql`, `,
  );
  const result = await tx.execute<{ live: number }>(sql`
    select count(*)::int as live from (
      select ${session.id}::text as id from ${session}
      where ${session.taskId} = ${taskId} and ${session.endedAt} is null and ${session.status} in (${live})
      union
      select ${processedWebhookEvent.payload}->>'sessionId' from ${processedWebhookEvent}
      where ${processedWebhookEvent.provider} = 'composio'
        and ${processedWebhookEvent.payload}->>'taskId' = ${taskId}
        and ${processedWebhookEvent.payload}->>'state' in ('creating', 'ambiguous')
    ) runs`);
  return result.rows.at(0)?.live ?? 0;
}

const LIVE_RUN_STATUSES = [
  'creating',
  'awaiting_opening',
  'opening',
  'running',
  'rescheduling',
  'resuming',
  'pausing',
] as const;

export async function recordTriggerDelivery(deliveryId: string, delivery: TriggerDelivery) {
  const sources = triggerDeliveryMachine.sourcesOf(delivery.state);
  if (sources.length === 0) return false;
  const rows = await db
    .update(processedWebhookEvent)
    .set({ payload: delivery })
    .where(
      and(deliveryWhere(deliveryId), sql`${processedWebhookEvent.payload}->>'state' in ${sources}`),
    )
    .returning({ eventId: processedWebhookEvent.eventId });
  return rows.length > 0;
}

export async function resumeTriggerDelivery(deliveryId: string): Promise<TriggerOutcome> {
  return db.transaction(async (tx) => {
    const row = (
      await tx.select().from(processedWebhookEvent).where(deliveryWhere(deliveryId)).for('update')
    ).at(0);
    const delivery = readDelivery(row?.payload);
    shipLog({
      level: delivery.state === 'ambiguous' || delivery.state === 'failed' ? 'error' : 'info',
      msg: 'composio_trigger.delivery_resumed',
      feature: 'tasks',
      op: 'handle-trigger',
      delivery_id: deliveryId,
      task_id: delivery.taskId,
      delivery_state: delivery.state,
    });
    switch (delivery.state) {
      case 'creating':
        // A process may have died after create was sent. No expiry or lease can
        // prove otherwise; redelivery must never start another remote session.
        return { handled: false, reason: 'delivery_in_progress' };
      case 'ambiguous':
        return { handled: false, reason: 'delivery_ambiguous' };
      case 'failed':
        return { handled: false, reason: 'delivery_failed' };
      case 'skipped':
        return { handled: false, reason: delivery.reason };
      case 'completed':
        return { handled: true, sessionId: delivery.sessionId };
      case 'session_created': {
        const startedAt = new Date(delivery.startedAt);
        // Keep a completion/webhook status that may already have arrived. Only
        // attach the run and fill its start time; never revive a finished run.
        const rows = await tx
          .update(session)
          .set({
            taskId: delivery.taskId,
            startedAt: sql`coalesce(${session.startedAt}, ${startedAt})`,
          })
          .where(
            and(
              eq(session.id, delivery.sessionId),
              eq(session.anthropicSessionId, delivery.anthropicSessionId),
              or(isNull(session.taskId), eq(session.taskId, delivery.taskId)),
            ),
          )
          .returning({ id: session.id });
        if (rows.length !== 1) {
          throw new WebhookError('SESSION_NOT_FOUND', 'Created trigger session cannot be linked', {
            delivery_id: deliveryId,
            session_id: delivery.sessionId,
            task_id: delivery.taskId,
          });
        }
        await recordEventRunStart(tx, delivery.taskId, startedAt);
        await tx
          .update(processedWebhookEvent)
          .set({ payload: { ...delivery, state: 'completed' } })
          .where(
            and(
              deliveryWhere(deliveryId),
              sql`${processedWebhookEvent.payload}->>'state' in ${triggerDeliveryMachine.sourcesOf('completed')}`,
            ),
          );
        return { handled: true, sessionId: delivery.sessionId };
      }
    }
  });
}
