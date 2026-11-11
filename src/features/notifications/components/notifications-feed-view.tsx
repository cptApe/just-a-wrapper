'use client';

import { useCallback, useState } from 'react';
import { IconBell01, IconCheckDone01 } from '@/components/icons';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { Button } from '@/components/ui/button';
import { CountBadge } from '@/components/ui/count-badge';
import { menuSurfaceClasses } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, ListRowContent, ListRowIcon } from '@/components/ui/list-row';
import { PillTabs } from '@/components/ui/pill-tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLoadMoreSentinel } from '@/hooks/use-load-more-sentinel';
import { cn } from '@/lib/utils';
import type { NotificationsFilter } from '../hooks/use-notifications-feed';
import { groupFeedItems } from '../lib/feed-display';
import type { FeedItem, FeedMetadata } from '../lib/feed-schema';
import type { FeedViewStatus } from '../types';
import { FeedRow } from './notification-feed-row';

export type { FeedViewStatus } from '../types';

const FEED_FILTER_OPTIONS: ReadonlyArray<{ value: NotificationsFilter; label: string }> = [
  { value: 'unread', label: 'Unread' },
  { value: 'all', label: 'All' },
];

export interface NotificationsFeedViewProps {
  status: FeedViewStatus;
  items: FeedItem[];
  metadata: FeedMetadata;
  filter: NotificationsFilter;
  onFilterChange: (filter: NotificationsFilter) => void;
  onOpenChange: (open: boolean) => void;
  onItemOpen: (item: FeedItem, groupedItems: FeedItem[]) => void;
  /** Mark one row read in place. */
  onMarkRead: (item: FeedItem | FeedItem[]) => void;
  /** Inline action on a needs-you row (Add credits · Reconnect · …). */
  onItemAction: (item: FeedItem, groupedItems: FeedItem[]) => void;
  onMarkAllRead: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  /** Replace the default bell button (e.g. the sidebar nav item). The element
      becomes the PopoverTrigger via asChild, so it must spread props + accept
      a ref (a plain <button> qualifies). */
  renderTrigger?: (ctx: { unread: number }) => React.ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
}

export function NotificationsFeedView({
  status,
  items,
  metadata,
  filter,
  onFilterChange,
  onOpenChange,
  onItemOpen,
  onMarkRead,
  onItemAction,
  onMarkAllRead,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
  renderTrigger,
  side = 'top',
  align = 'end',
  sideOffset,
}: NotificationsFeedViewProps) {
  const unread = metadata.unreadCount;
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange(next);
    },
    [onOpenChange],
  );

  // Opening an item navigates without unmounting the shell, so close the popover here.
  const handleItemOpen = useCallback(
    (item: FeedItem, groupedItems: FeedItem[]) => {
      onItemOpen(item, groupedItems);
      setOpen(false);
    },
    [onItemOpen],
  );
  const handleItemAction = useCallback(
    (item: FeedItem, groupedItems: FeedItem[]) => {
      onItemAction(item, groupedItems);
      setOpen(false);
    },
    [onItemAction],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {renderTrigger ? (
          renderTrigger({ unread })
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={unread > 0 ? `Notifications (${unread} new)` : 'Notifications'}
            className="relative"
          >
            <IconBell01 className="size-4" />
            {unread > 0 ? (
              <CountBadge
                count={unread}
                data-testid="notifications-badge"
                className="absolute -right-0.5 -top-0.5"
              />
            ) : null}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        // The one glass surface (menuSurfaceClasses), consumed here instead of
        // re-declared: same bg/blur/radius/shadow as every menu, from a single
        // source. This panel stays a Popover (not DropdownMenu) because its
        // All/Unread tablist can't live inside a role="menu"; `dark` re-resolves
        // the feed rows' standard tokens against the always-dark glass.
        className={cn(
          menuSurfaceClasses,
          'dark flex w-[400px] max-w-[calc(100vw-2rem)] flex-col p-0',
        )}
        style={{ colorScheme: 'dark' }}
      >
        <FeedHeader
          unread={metadata.unreadCount}
          filter={filter}
          onFilterChange={onFilterChange}
          onMarkAllRead={onMarkAllRead}
        />
        {/* Nested radii follow outer radius minus inset. Add one pixel to the unread
         * row radius to account for its inward ring, which becomes the visible edge. */}
        <div className="min-h-50 max-h-[min(600px,70vh)] overflow-y-auto overscroll-contain p-2 pt-0">
          <FeedList
            status={status}
            items={items}
            filter={filter}
            onItemOpen={handleItemOpen}
            onMarkRead={onMarkRead}
            onItemAction={handleItemAction}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
            onRetry={onRetry}
            listTestId="notifications-list"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The scrollable feed body — rows + tail states. Shared verbatim by the
    popover above and the #notifications overlay (same rows, different frame). */
export function FeedList({
  status,
  items,
  filter,
  onItemOpen,
  onMarkRead,
  onItemAction,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
  listTestId,
}: {
  status: FeedViewStatus;
  items: FeedItem[];
  filter: NotificationsFilter;
  onItemOpen: (item: FeedItem, groupedItems: FeedItem[]) => void;
  onMarkRead: (item: FeedItem | FeedItem[]) => void;
  onItemAction: (item: FeedItem, groupedItems: FeedItem[]) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  listTestId: string;
}) {
  const { timeZone } = useDisplayFormat();
  // Initial and scope-switch loads use one muted pulsing block.
  // Load-more uses row skeletons because it appends beneath visible items.
  if (status === 'loading') {
    return (
      <div className="p-2" aria-busy="true" aria-label="Loading notifications">
        <Skeleton className="h-44 w-full rounded-lg" />
      </div>
    );
  }
  if (status !== 'ready' || items.length === 0) {
    return <FeedEmptyState status={status} filter={filter} onRetry={onRetry} />;
  }
  return (
    <ul className="flex flex-col gap-1" data-testid={listTestId}>
      {groupFeedItems(items, timeZone).map((group) => (
        <FeedRow
          key={group.key}
          item={group.item}
          groupedItems={group.items}
          onOpen={onItemOpen}
          onMarkRead={onMarkRead}
          onAction={onItemAction}
        />
      ))}
      {loadingMore ? <FeedRowSkeletons /> : null}
      {hasMore && !loadingMore ? <FeedLoadMoreSentinel onLoadMore={onLoadMore} /> : null}
    </ul>
  );
}

export function FeedHeader({
  unread,
  filter,
  onFilterChange,
  onMarkAllRead,
}: {
  unread: number;
  filter: NotificationsFilter;
  onFilterChange: (filter: NotificationsFilter) => void;
  onMarkAllRead: () => void;
}) {
  return (
    // No "Notifications" title here: the trigger already names the panel, so an
    // inner heading is redundant. The header is just the scope toggle +
    // mark-all-read.
    <div className="flex flex-col gap-2 px-4 pb-2.5 pt-3.5">
      <div className="flex items-center justify-between">
        <PillTabs
          value={filter}
          options={FEED_FILTER_OPTIONS}
          onChange={onFilterChange}
          label="Filter notifications"
        />
        {unread > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Mark all as read"
                onClick={onMarkAllRead}
                className="text-muted-foreground"
              >
                <IconCheckDone01 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Mark all as read</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

/** The load-more tail mirrors FeedRow's frame so appended rows do not jump. */
function FeedRowSkeletons() {
  return (
    <>
      {Array.from({ length: 3 }, (_, i) => (
        <li key={i} aria-hidden>
          <ListRow className="pr-10">
            <ListRowIcon>
              <Skeleton className="size-4 rounded-sm" />
            </ListRowIcon>
            <ListRowContent>
              <Skeleton className="h-4 max-w-full" style={{ width: `${64 - i * 8}%` }} />
              <Skeleton className="h-3 w-3/4 max-w-[220px]" />
              <Skeleton className="h-3 w-14" />
            </ListRowContent>
          </ListRow>
        </li>
      ))}
    </>
  );
}

function FeedLoadMoreSentinel({ onLoadMore }: { onLoadMore: () => void }) {
  const ref = useLoadMoreSentinel<HTMLLIElement>({
    canLoadMore: true,
    loadMore: onLoadMore,
    rootMargin: '150px',
  });
  return <li ref={ref} aria-hidden className="h-px" />;
}

/** The error / empty body, shared with the overlay. */
function FeedEmptyState({
  status,
  filter,
  onRetry,
}: {
  status: Exclude<FeedViewStatus, 'loading'>;
  filter: NotificationsFilter;
  onRetry: () => void;
}) {
  // The empty states are title-only: an icon tile above one line, slightly
  // larger, with no trailing period. Error keeps its
  // explanatory line so the user knows to retry.
  const { heading, body } =
    status === 'error'
      ? { heading: 'Couldn’t load notifications', body: 'Check your connection and try again.' }
      : filter === 'unread'
        ? { heading: 'No unread notifications', body: null }
        : { heading: 'No notifications yet', body: null };

  return (
    <div
      data-testid="notifications-empty"
      data-status={status}
      className="flex min-h-48 flex-col justify-center"
    >
      <EmptyState
        icon={IconBell01}
        title={heading}
        description={body ?? undefined}
        action={
          status === 'error' ? (
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : undefined
        }
        className="rounded-none bg-transparent px-4 py-12"
      />
    </div>
  );
}
