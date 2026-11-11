'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { useNotificationsFeed } from '../hooks/use-notifications-feed';
import type { FeedItem } from '../lib/feed-schema';
import { NotificationsFeedView, type NotificationsFeedViewProps } from './notifications-feed-view';

type NotificationsBellProps = Pick<
  NotificationsFeedViewProps,
  'renderTrigger' | 'side' | 'align' | 'sideOffset'
>;

export function NotificationsBell(viewProps: NotificationsBellProps = {}) {
  const router = useRouter();
  const feed = useNotificationsFeed();
  const { markRead } = feed;
  const onItemOpen = useCallback(
    (item: FeedItem, groupedItems: FeedItem[]) => {
      markRead(groupedItems);
      if (item.data.link) router.push(item.data.link);
    },
    [markRead, router],
  );

  return (
    <NotificationsFeedView
      onOpenChange={(open) => {
        if (open && feed.metadata.unseenCount > 0) feed.markSeen();
      }}
      status={feed.status}
      items={feed.items}
      metadata={feed.metadata}
      filter={feed.filter}
      onFilterChange={feed.setFilter}
      onItemOpen={onItemOpen}
      onItemAction={onItemOpen}
      onMarkRead={feed.markRead}
      onMarkAllRead={feed.markAllRead}
      hasMore={feed.hasMore}
      loadingMore={feed.loadingMore}
      onLoadMore={feed.loadMore}
      onRetry={feed.retry}
      {...viewProps}
    />
  );
}
