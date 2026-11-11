import { z } from 'zod';

export const chatStatusSchema = z.enum([
  'running',
  'idle',
  'rescheduled',
  'rescheduling',
  'requires_input',
  'terminated',
  'paused_no_credits',
]);
export type ChatStatus = z.infer<typeof chatStatusSchema>;
