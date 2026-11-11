'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { Modal, ModalContent, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { TooltipProvider } from '@/components/ui/tooltip';
// A type-only import prevents the overlay registry from creating a runtime module cycle.
import type { OverlayComponentProps } from '@/features/overlays';
import { useNotificationsFeed } from '../hooks/use-notifications-feed';
import type { FeedItem } from '../lib/feed-schema';
import { FeedHeader, FeedList } from './notifications-feed-view';

export function NotificationsOverlay({ open, onClose }: OverlayComponentProps) {
  const router = useRouter();
  const feed = useNotificationsFeed();
  const { status, markRead, markSeen } = feed;
  useEffect(() => {
    if (open && feed.metadata.unseenCount > 0) markSeen();
  }, [open, markSeen, feed.metadata.unseenCount]);
  const onItemOpen = useCallback(
    (item: FeedItem, groupedItems: FeedItem[]) => {
      markRead(groupedItems);
      onClose();
      if (item.data.link) router.push(item.data.link);
    },
    [markRead, onClose, router],
  );

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      presentation="dialog"
      size="sm"
      mobile="bottomSheet"
    >
      <ModalHeader>
        <ModalTitle>Notifications</ModalTitle>
      </ModalHeader>
      {/* OverlayHost mounts outside AppShell's TooltipProvider; the feed's
          icon buttons carry Radix tooltips, which throw without one. */}
      <TooltipProvider delayDuration={300}>
        <FeedHeader
          unread={feed.metadata.unreadCount}
          filter={feed.filter}
          onFilterChange={feed.setFilter}
          onMarkAllRead={feed.markAllRead}
        />
        <ModalContent className="px-2 pb-2">
          <FeedList
            status={status}
            items={feed.items}
            filter={feed.filter}
            onItemOpen={onItemOpen}
            onMarkRead={feed.markRead}
            onItemAction={onItemOpen}
            hasMore={feed.hasMore}
            loadingMore={feed.loadingMore}
            onLoadMore={feed.loadMore}
            onRetry={feed.retry}
            listTestId="notifications-overlay-list"
          />
        </ModalContent>
      </TooltipProvider>
    </Modal>
  );
}
