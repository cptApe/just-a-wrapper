'use client';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useOrganizationId, useViewer } from '@/components/providers/app-providers';
import { useWorkspaceChannel } from '@/features/realtime/hooks/use-workspace-channel';
import { fetchJson } from '@/lib/fetch-json';
import { invalidateUnlessWriting, optimisticMutation } from '@/lib/optimistic-mutation';
import { notificationKeys } from '../api/keys';
import { applyFeedRead, type FeedCache } from '../lib/feed-read-cache';
import {
  type FeedItem,
  type FeedMetadata,
  feedPageSchema,
  type NotificationReadInput,
} from '../lib/feed-schema';
import { EMPTY_FEED_METADATA, type FeedViewStatus } from '../types';
export type NotificationsFilter = 'all' | 'unread';
export type NotificationsFeed = {
  status: FeedViewStatus;
  items: FeedItem[];
  metadata: FeedMetadata;
  filter: NotificationsFilter;
  setFilter: (filter: NotificationsFilter) => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  retry: () => void;
  markRead: (item: FeedItem | FeedItem[]) => void;
  markAllRead: () => void;
  markSeen: () => void;
};
const emptyCursor: string | null = null;
export function useNotificationsFeed(): NotificationsFeed {
  const organizationId = useOrganizationId();
  const userId = useViewer()?.id ?? null;
  // Unread is the triage default; distinct query keys prevent a filter switch showing old rows.
  const [filter, setFilter] = useState<NotificationsFilter>('unread');
  const client = useQueryClient();
  const key = notificationKeys.all(organizationId, userId);
  const feed = useInfiniteQuery({
    queryKey: notificationKeys.feed(organizationId, userId, filter),
    enabled: Boolean(organizationId && userId),
    initialPageParam: emptyCursor,
    queryFn: async ({ pageParam }) => {
      const parameters = new URLSearchParams({ filter });
      if (pageParam) parameters.set('after', pageParam);
      return feedPageSchema.parse(await fetchJson(`/api/notifications?${parameters}`));
    },
    getNextPageParam: (page) => page.after,
  });
  useWorkspaceChannel(organizationId, userId, (event) => {
    if (
      event.type === 'notification' ||
      event.type === 'notifications_read' ||
      event.type === 'resync'
    )
      invalidateUnlessWriting(client, key);
  });
  const mutation = useMutation({
    mutationFn: (input: NotificationReadInput) =>
      fetchJson('/api/notifications', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'content-type': 'application/json' },
      }),
    ...optimisticMutation(client, {
      root: key,
      apply: (input: NotificationReadInput) =>
        void client.setQueriesData<FeedCache>({ queryKey: key }, (old) =>
          applyFeedRead(old, input),
        ),
      // Marking seen is a background write the reader never asked for.
      failure: (_error, input) =>
        input.scope === 'seen'
          ? null
          : {
              message: 'Couldn’t update your notifications. Try again.',
              capture: { op: 'notifications-mark-read', scope: input.scope },
            },
    }),
  });
  const mutate = mutation.mutate;
  const markSeen = useCallback(() => mutate({ scope: 'seen' }), [mutate]);
  const loaded = feed.data?.pages.flatMap((page) => page.items) ?? [];
  // Read rows stay cached so a failed write can restore them; the Unread tab hides them here.
  const items = filter === 'unread' ? loaded.filter((item) => !item.readAt) : loaded;
  return {
    status: feed.isError ? 'error' : feed.isPending ? 'loading' : 'ready',
    items,
    metadata: feed.data?.pages[0]?.metadata ?? EMPTY_FEED_METADATA,
    filter,
    setFilter,
    hasMore: feed.hasNextPage,
    loadingMore: feed.isFetchingNextPage,
    loadMore: () => {
      void feed.fetchNextPage();
    },
    retry: () => {
      mutation.reset();
      void feed.refetch();
    },
    markRead: (items) =>
      mutation.mutate({
        scope: 'selected',
        ids: (Array.isArray(items) ? items : [items]).map((item) => item.id),
      }),
    markAllRead: () => mutation.mutate({ scope: 'all' }),
    markSeen,
  };
}
