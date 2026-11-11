import { z } from 'zod';

export const MediaBillingSchema = z.object({
  generationId: z.string().nullable(),
  model: z.string(),
  estimatedCostCents: z.number().finite().nonnegative(),
});
export type MediaBilling = z.infer<typeof MediaBillingSchema>;
