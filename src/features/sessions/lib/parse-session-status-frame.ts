import { z } from 'zod';
import { chatStatusSchema } from '@/lib/chat-status';
import type { ChatEvent } from '../types';

const optionalText = z
  .unknown()
  .transform((value) => (typeof value === 'string' ? value : undefined));
const statusFrameSchema = z.object({
  type: z.literal('event'),
  event: z.object({
    kind: z.literal('status'),
    status: chatStatusSchema,
    id: z.string(),
    rawType: z.string(),
    stopReason: optionalText.optional(),
    at: optionalText.optional(),
  }),
});

// Background sidebar streams consume status only, never transcript contents.
export function parseSessionStatusFrame(
  value: unknown,
): Extract<ChatEvent, { kind: 'status' }> | null {
  const parsed = statusFrameSchema.safeParse(value);
  if (!parsed.success) return null;
  const { stopReason, at, ...event } = parsed.data.event;
  return {
    ...event,
    ...(stopReason !== undefined ? { stopReason } : {}),
    ...(at !== undefined ? { at } : {}),
  };
}
