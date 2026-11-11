import { z } from 'zod';

export const browseOpenInput = z.object({ url: z.string().url().max(2048) });
export const browseOpenOutput = z.object({
  browserbaseSessionId: z.string(),
  url: z.string(),
  title: z.string(),
  reused: z.boolean(),
  message: z.string(),
});

export const browseActInput = z.object({
  instruction: z.string().trim().min(1).max(4000),
  operation: z.enum(['act', 'extract', 'observe']).default('act'),
});
export const browseActOutput = z.object({
  success: z.boolean(),
  browserbaseSessionId: z.string().optional(),
  result: z.string().max(11_000),
  url: z.string().optional(),
  title: z.string().optional(),
  vendorCostCents: z.number().nonnegative(),
});

export const browseCloseInput = z.object({}).strict();
export const browseCloseOutput = z.object({
  success: z.boolean(),
  browserbaseSessionId: z.string().optional(),
  durationSeconds: z.number().nonnegative(),
  vendorCostCents: z.number().nonnegative(),
  message: z.string(),
});
