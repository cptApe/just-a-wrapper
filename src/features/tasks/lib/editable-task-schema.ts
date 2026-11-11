import { z } from 'zod';
import type { task } from '@/db/schema';
import { TASK_NOTIFICATIONS } from '@/features/notifications/lib/task-notification';
import { TASK_TIERS } from '../constants';
import { taskMachine } from './task-machine';

const storedAttachmentsSchema: z.ZodType<NonNullable<typeof task.$inferSelect.attachments>> =
  z.object({
    files: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        url: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number(),
      }),
    ),
    folders: z.array(z.object({ path: z.string(), name: z.string(), itemCount: z.number() })),
  });

export const editableTaskSchema = z.object({
  id: z.string(),
  // The version this copy was read at; a save must send it back.
  version: z.number().int(),
  status: z.enum(taskMachine.states),
  title: z.string(),
  icon: z.string().nullable().optional(),
  description: z.string(),
  successCriteria: z.string(),
  triggerType: z.enum(['schedule', 'event']),
  tier: z.enum(TASK_TIERS),
  autoApprove: z.boolean(),
  notification: z.enum(TASK_NOTIFICATIONS),
  attachments: storedAttachmentsSchema.nullable(),
  cron: z.string().nullable(),
  runAt: z.union([z.date(), z.iso.datetime().transform((value) => new Date(value))]).nullable(),
  timezone: z.string().nullable(),
  toolkit: z.string().nullable(),
  eventType: z.string().nullable(),
});
