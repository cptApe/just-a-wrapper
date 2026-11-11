import { z } from 'zod';
import { chatStatusSchema } from './chat-status';

export const workspaceEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session_status'),
    sessionId: z.string(),
    status: chatStatusSchema,
    pausedReason: z.enum(['credits', 'budget', 'member_limit']).optional(),
    lastEventId: z.string().optional(),
  }),
  z.object({
    type: z.literal('session_title'),
    sessionId: z.string(),
    title: z.string(),
    previousTitle: z.string().optional(),
  }),
  z.object({
    type: z.literal('session_visibility'),
    sessionId: z.string(),
    visibility: z.enum(['private', 'workspace']),
  }),
  z.object({ type: z.literal('credits'), balance: z.number() }),
  z.object({ type: z.literal('notification'), notificationId: z.string() }),
  z.object({ type: z.literal('notifications_read') }),
]);
export type StoredWorkspaceEvent = z.infer<typeof workspaceEventSchema>;
export type StoredPublishedEvent = StoredWorkspaceEvent & { publishedAt: number };
export const publishedEventSchema = workspaceEventSchema.and(z.object({ publishedAt: z.number() }));
