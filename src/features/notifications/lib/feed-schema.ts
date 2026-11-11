import { z } from 'zod';

// Links stay on this site: a protocol-relative path would leave it. A bad link
// drops only that link, so one stored row cannot take down the whole feed.
const notificationLinkSchema = z
  .string()
  .regex(/^\/(?![/\\])/)
  .optional()
  .catch(undefined);

const feedItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
  data: z.looseObject({
    link: notificationLinkSchema,
    category: z.enum(['needs_you', 'fyi']).optional().catch(undefined),
  }),
});
export const feedPageSchema = z.object({
  items: z.array(feedItemSchema),
  after: z.string().nullable(),
  metadata: z.object({
    totalCount: z.number(),
    unreadCount: z.number(),
    unseenCount: z.number(),
  }),
});
export type FeedItem = z.infer<typeof feedItemSchema>;
export type FeedMetadata = z.infer<typeof feedPageSchema>['metadata'];
export const feedInputSchema = z.object({
  filter: z.enum(['all', 'unread']).default('unread'),
  after: z.string().nullable().default(null),
});
export const readInputSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('all') }),
  z.object({ scope: z.literal('seen') }),
  z.object({ scope: z.literal('selected'), ids: z.array(z.uuid()).min(1).max(100) }),
]);
export type NotificationReadInput = z.infer<typeof readInputSchema>;
