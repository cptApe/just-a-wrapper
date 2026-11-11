import { z } from 'zod';

const sessionRecord = {
  taskId: z.string(),
  sessionId: z.string(),
  anthropicSessionId: z.string(),
  startedAt: z.iso.datetime(),
};

// Stored in processed_webhook_event.payload, isolated by provider='composio'.
export const triggerDeliverySchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('creating'), taskId: z.string(), sessionId: z.string() }),
  z.object({ state: z.literal('session_created'), ...sessionRecord }),
  z.object({ state: z.literal('completed'), ...sessionRecord }),
  z.object({ state: z.literal('failed'), taskId: z.string(), errorCode: z.string() }),
  // Recorded instead of a run when the task already has its cap of live runs, or the spend gate
  // refuses the task creator.
  z.object({
    state: z.literal('skipped'),
    taskId: z.string(),
    reason: z.enum(['run_limit', 'credits', 'member_limit']),
  }),
  z.object({
    state: z.literal('ambiguous'),
    taskId: z.string(),
    errorCode: z.string(),
    sessionId: z.string().optional(),
    anthropicSessionId: z.string().optional(),
  }),
]);
