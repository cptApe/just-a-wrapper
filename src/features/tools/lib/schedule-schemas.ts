import { z } from 'zod';
import { isFiveFieldCron, isIanaTimezone } from '@/features/tasks/lib/validate-schedule';

const tierSchema = z.enum(['fast', 'default', 'pro']);
const cronSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isFiveFieldCron, 'Cron must be a valid five-field expression.');
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isIanaTimezone, 'Timezone must be a valid IANA timezone.');

export const CreateScheduleInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    prompt: z.string().trim().min(1).max(8000),
    cron: cronSchema.optional(),
    run_at: z.iso.datetime({ offset: true }).optional(),
    timezone: timezoneSchema.optional(),
    success_criteria: z.string().trim().max(8000).optional(),
    tier: tierSchema.optional(),
  })
  .refine((value) => (value.cron === undefined) !== (value.run_at === undefined), {
    message: 'Provide exactly one of cron or run_at.',
  });

export const ListSchedulesInputSchema = z.object({});

export const UpdateScheduleInputSchema = z
  .object({
    schedule_id: z.uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    prompt: z.string().trim().min(1).max(8000).optional(),
    cron: cronSchema.optional(),
    run_at: z.iso.datetime({ offset: true }).optional(),
    timezone: timezoneSchema.optional(),
    success_criteria: z.string().trim().max(8000).nullable().optional(),
    tier: tierSchema.optional(),
    paused: z.boolean().optional(),
  })
  .refine(
    (value) =>
      Object.entries(value)
        .filter(([key]) => key !== 'schedule_id')
        .some((entry) => entry.at(1) !== undefined),
    'Provide at least one schedule change.',
  )
  .refine((value) => !(value.cron !== undefined && value.run_at !== undefined), {
    message: 'Provide either cron or run_at, not both.',
    path: ['run_at'],
  });

export const DeleteScheduleInputSchema = z.object({
  schedule_id: z.uuid(),
  title: z.string().trim().min(1).max(200),
});

const scheduleSummarySchema = z.object({
  schedule_id: z.string(),
  title: z.string(),
  label: z.string(),
  paused: z.boolean(),
  next_run_at: z.string().nullable(),
  last_run_outcome: z.enum(['passed', 'passed_after_revision', 'not_passed']).nullable(),
  finished: z.boolean(),
  stale: z.boolean(),
});

export const CreateScheduleOutputSchema = scheduleSummarySchema.pick({
  schedule_id: true,
  next_run_at: true,
  label: true,
});
export const ListSchedulesOutputSchema = z.object({ schedules: z.array(scheduleSummarySchema) });
export const UpdateScheduleOutputSchema = scheduleSummarySchema;
export const DeleteScheduleOutputSchema = z.object({
  schedule_id: z.string(),
  title: z.string(),
  deleted: z.literal(true),
});
