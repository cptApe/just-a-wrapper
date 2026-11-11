import { z } from 'zod';
import { MediaBillingSchema } from '@/lib/media-billing';
import { defineStateMachine } from '@/lib/state-machine';

export type ToolDeliveryStatus =
  | 'awaiting_decision'
  | 'claimed'
  | 'executing'
  | 'ready'
  | 'delivering'
  | 'delivered'
  | 'completed'
  | 'abandoned';

// A call waiting for a person has its own state, so the stale-claim recovery never matches it.
export const toolDeliveryMachine = defineStateMachine<ToolDeliveryStatus>('tool delivery', {
  awaiting_decision: ['claimed', 'ready'],
  claimed: ['executing', 'ready'],
  executing: ['ready'],
  ready: ['delivering'],
  delivering: ['ready', 'delivered', 'abandoned'],
  delivered: ['completed'],
  completed: [],
  abandoned: [],
});

export const TOOL_EXECUTION_LEASE_MS = 300_000;
export const TOOL_DECISION_MAX_AGE_MS = 86_400_000;

export const toolDeliverySchema = z.object({
  isError: z.boolean(),
  content: z.unknown(),
  vendorCostCents: z.number().nonnegative().optional(),
  mediaBilling: MediaBillingSchema.optional(),
  source: z.enum(['tool_call', 'generation']),
  detail: z.string().optional(),
});
export type ToolDelivery = z.infer<typeof toolDeliverySchema>;

export type ToolDecisionStatus = 'pending' | 'approved' | 'denied';

export const confirmationMachine = defineStateMachine<ToolDecisionStatus>('tool decision', {
  pending: ['approved', 'denied'],
  approved: [],
  denied: [],
});
