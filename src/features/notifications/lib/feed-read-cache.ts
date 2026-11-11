import type { InfiniteData } from '@tanstack/react-query';
import type { z } from 'zod';
import type { feedPageSchema, NotificationReadInput } from './feed-schema';

type FeedPage = z.infer<typeof feedPageSchema>;
export type FeedCache = InfiniteData<FeedPage, string | null>;

// Marks loaded rows read and adjusts totals in place. Counts cover rows beyond the loaded pages,
// so a selected read subtracts only rows that were unread here; the settling refetch reconciles.
export function applyFeedRead(
  feed: FeedCache | undefined,
  input: NotificationReadInput,
): FeedCache | undefined {
  if (!feed) return feed;
  const all = input.scope === 'all';
  const selected = input.scope === 'selected' ? new Set(input.ids) : null;
  const matches = (item: FeedPage['items'][number]) =>
    !item.readAt && (all || (selected?.has(item.id) ?? false));
  const newlyRead = feed.pages.flatMap((page) => page.items).filter(matches).length;
  return {
    ...feed,
    pages: feed.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (matches(item) ? { ...item, readAt: item.createdAt } : item)),
      metadata: {
        ...page.metadata,
        unreadCount: all ? 0 : Math.max(0, page.metadata.unreadCount - newlyRead),
        unseenCount: all || input.scope === 'seen' ? 0 : page.metadata.unseenCount,
      },
    })),
  };
}
