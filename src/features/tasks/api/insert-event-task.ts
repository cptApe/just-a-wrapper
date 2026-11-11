import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { task as taskTable } from '@/db/schema';
import { AppError, BillingError } from '@/lib/errors';
import { isUniqueViolation } from '@/lib/is-unique-violation';
import { composioCapability } from '@/lib/runtime-capabilities';
import type { CreateEventTaskInput } from '../types';
import { assertCanCreateScheduledTask } from './assert-schedule-limit';
import { deleteTriggerInstance } from './composio-triggers';

/** An event task takes a schedule slot under the same plan lock as a scheduled one (F071). */
export async function insertEventTask(input: CreateEventTaskInput, triggerId: string) {
  try {
    const row = await db.transaction(async (tx) => {
      await assertCanCreateScheduledTask(input.workspaceId, input.createdByUserId, tx);
      return (
        await tx
          .insert(taskTable)
          .values({
            workspaceId: input.workspaceId,
            createdByUserId: input.createdByUserId,
            tier: input.tier,
            autoApprove: input.autoApprove,
            notification: input.notification,
            attachments: input.attachments ?? null,
            title: input.title.trim(),
            icon: input.icon,
            description: input.description.trim(),
            triggerType: 'event',
            composioTriggerId: triggerId,
            eventToolkit: input.toolkit,
            eventType: input.eventType,
          })
          .returning({ id: taskTable.id })
      ).at(0);
    });
    if (!row)
      throw new AppError('UNEXPECTED', 'Task insert returned no row', {
        workspaceId: input.workspaceId,
      });
    return row;
  } catch (error) {
    // Composio upserts are idempotent per (slug, account): a second task on the same trigger
    // instance trips the unique index. The instance stays; it belongs to the existing task.
    if (isUniqueViolation(error, 'task_composio_trigger_id_uidx'))
      throw new AppError(
        'TOOL_INPUT_INVALID',
        'A task for this trigger already exists. Edit or delete it instead.',
        { eventType: input.eventType },
        { cause: error },
      );
    // The plan filled while the trigger was subscribed; an instance no task owns is deleted.
    if (error instanceof BillingError && error.code === 'PLAN_LIMIT_REACHED')
      await deleteUnownedTrigger(triggerId);
    throw error;
  }
}

async function deleteUnownedTrigger(triggerId: string): Promise<void> {
  const owner = (
    await db
      .select({ id: taskTable.id })
      .from(taskTable)
      .where(eq(taskTable.composioTriggerId, triggerId))
      .limit(1)
  ).at(0);
  if (!owner) await deleteTriggerInstance(composioCapability().apiKey, triggerId);
}
