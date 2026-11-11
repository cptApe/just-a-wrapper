import { z } from 'zod';
import { TASK_NOTIFICATIONS } from '@/features/notifications/lib/task-notification';
import { TASK_TIERS } from '../constants';
import { TaskAttachmentsSchema } from '../lib/task-attachments';
import { isTaskIcon } from '../lib/task-icon';

const Base = z.object({
  // trim() before min(1): a whitespace-only name/prompt is a 400 here, not a
  // feature-level throw later.
  icon: z.string().max(100).refine(isTaskIcon).nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(8000),
  tier: z.enum(TASK_TIERS),
  autoApprove: z.boolean(),
  notification: z.enum(TASK_NOTIFICATIONS),
  attachments: TaskAttachmentsSchema.nullable().optional(),
});

const CreateBase = Base.extend({
  tier: Base.shape.tier.default('default'),
  autoApprove: Base.shape.autoApprove.default(false),
  notification: Base.shape.notification.default('email_app'),
});

export const CreateTaskBody = z
  .discriminatedUnion('triggerType', [
    CreateBase.extend({
      triggerType: z.literal('schedule'),
      successCriteria: z.string().trim().max(8000).nullable().default(null),
      cron: z.string().min(9).max(100).optional(),
      runAt: z.iso
        .datetime()
        .transform((value) => new Date(value))
        .optional(),
      timezone: z.string().min(1).max(64),
    }),
    CreateBase.extend({
      triggerType: z.literal('event'),
      toolkit: z.string().min(1).max(64),
      eventType: z.string().min(1).max(128),
    }),
  ])
  .refine(
    (data) =>
      data.triggerType === 'event' || (data.cron !== undefined) !== (data.runAt !== undefined),
    { message: 'Choose a repeating schedule or a date.' },
  );

export const PatchTaskBody = Base.partial({
  tier: true,
  autoApprove: true,
  notification: true,
}).extend({
  // The version the form was opened at; a newer save in between makes this one a CONFLICT.
  version: z.number().int().min(1),
  successCriteria: z.string().trim().max(8000).nullable().optional(),
  // Present only for schedule tasks; the feature validates them against the
  // stored trigger type.
  runAt: z.iso
    .datetime()
    .transform((value) => new Date(value))
    .optional(),
  cron: z.string().min(9).max(100).optional(),
  timezone: z.string().min(1).max(64).optional(),
});
