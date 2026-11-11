'use client';

import { type InfiniteData, skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
// Import the hook directly, not via the realtime feature barrel: the barrel also
// re-exports the server-only publish helper (`next/server`'s `after`), which
// would be pulled into this client bundle and break the build (same as chat-view).
import { useWorkspaceChannel } from '@/features/realtime/hooks/use-workspace-channel';
import { shouldApplySessionTitle } from '@/features/realtime/lib/channel';
import type { WorkspaceSessionListItem } from '@/features/sessions';
import { scheduleSessionListInvalidate } from '@/features/sessions/api/invalidate';
import { sessionQueryKeys } from '@/features/sessions/api/keys';
import { mergePendingSessionRows, patchRow } from '@/features/sessions/api/session-list-cache';
import {
  sessionDispatchKeys,
  sessionDisplayStatus,
  sessionStatus,
  updateSessionActivity,
} from '@/features/sessions/api/session-live-cache';
import { usePendingSessionCreates } from '@/features/sessions/api/use-create-session';
import type { SessionsPage } from '@/features/sessions/api/use-session-list';
import { useSessionList } from '@/features/sessions/api/use-session-list';
import type { useSessionMutations } from '@/features/sessions/api/use-session-mutations';
import { useBackgroundSessionStreams } from '@/features/sessions/hooks/use-background-session-streams';
import { displaySessionTitle } from '@/features/sessions/lib/title-prompt';
import { captureException } from '@/lib/observability-client';
import { searchQueryKeys } from '@/lib/search-query-keys';
import { organizationId as trustedOrganizationId } from '@/lib/tenant-id';

// State for the sidebar Tasks list, backed by React Query. The
// server-rendered layout passes the authoritative FIRST page; useSessionList
// seeds it as `initialData` so mount paints the real list with no refetch, and
// layers older cursor pages under the same key. The row actions (rename /
// favorite / soft-delete) and the Home create are optimistic mutations that edit
// that one cache. Pending creates also render from React Query mutation state
// until success, so an in-flight list refetch cannot erase their provisional rows.
//
// Realtime: the workspace channel's `session_title` / `session_status` events
// become targeted cache writes — `setQueryData` when the payload fully specifies
// the row's new value (status flips patch status + unread + lastEventAt in
// place through the shared live cache, no refetch), a debounced
// `invalidateQueries` only when the server list must re-derive (a visibility
// change, or an event for an unknown id means a row we don't have yet). No full
// router refresh: only the sidebar cache updates, not the whole RSC tree.

type InfiniteSessions = InfiniteData<SessionsPage, string | null>;

export function useTaskList(
  initial: WorkspaceSessionListItem[],
  organizationId: string,
  userId: string,
  initialNextCursor: string | null,
  markSeen: ReturnType<typeof useSessionMutations>['markSeen'],
) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const listKey = useMemo(() => sessionQueryKeys.list(organizationId), [organizationId]);

  const {
    items: fetchedItems,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSessionList({
    organizationId,
    initialItems: initial,
    initialCursor: initialNextCursor,
  });
  const pendingCreates = usePendingSessionCreates(organizationId);
  const items = mergePendingSessionRows(fetchedItems, pendingCreates);
  // Local subscription only: the mounted dispatcher publishes ownership here.
  // Server status remains authoritative for completion, credit pauses and stops.
  const { data: dispatchActivity } = useQuery<Readonly<Record<string, boolean>>>({
    queryKey: sessionDispatchKeys.workspace(trustedOrganizationId(organizationId)),
    initialData: {},
    queryFn: skipToken,
  });

  // Latest merged list for the realtime handler (the channel hook keeps the
  // latest callback; this keeps the latest data inside that callback).
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Collapse bursts of invalidation-triggering events into one refetch — through
  // the SHARED per-workspace scheduler so the realtime handler and the mutations'
  // onSettled coalesce into one GET /api/sessions during a send (invalidate.ts).
  const scheduleInvalidate = useCallback(
    () => scheduleSessionListInvalidate(queryClient, organizationId),
    [queryClient, organizationId],
  );

  // Realtime session events are keyed on OUR session uuid — the same
  // `id` the row actions, links, and render already use — so match the row
  // directly by `id`. The upstream Anthropic id never reaches the client.
  useWorkspaceChannel(organizationId, userId, (event) => {
    // A share/unshare  flips a session between private and workspace
    // visibility, which changes whether it belongs in THIS viewer's list — a
    // patch-if-present write can't add a newly-shared row or drop a newly-private
    // one, so always re-derive from the server (debounced). Unconditional: both
    // directions must refresh correctly.
    if (event.type === 'session_visibility' || event.type === 'resync') {
      scheduleInvalidate();
      return;
    }
    if (event.type === 'session_title' || event.type === 'session_status') {
      void queryClient.invalidateQueries({ queryKey: searchQueryKeys.all(organizationId) });
    }
    if (event.type === 'session_title') {
      const present = itemsRef.current.some((s) => s.id === event.sessionId);
      if (present) {
        // The event fully specifies the new title — write it straight to cache.
        queryClient.setQueryData<InfiniteSessions>(listKey, (old) => {
          const row = old?.pages
            .flatMap((page) => page.items)
            .find((item) => item.id === event.sessionId);
          return shouldApplySessionTitle(row?.title, event)
            ? patchRow(old, event.sessionId, { title: event.title })
            : old;
        });
      } else {
        scheduleInvalidate();
      }
      return;
    }
    if (event.type === 'session_status') {
      const present = itemsRef.current.find((s) => s.id === event.sessionId);
      if (present) {
        const status = sessionStatus(event.status);
        if (status && status === present.status) {
          // SSE may have painted this transition before its database/stream echo.
          // Keep a turn viewed at completion read even if the viewer has since
          // navigated away, and persist seen AFTER that server write.
          if (!present.unread && status !== 'running' && status !== 'rescheduling') {
            markSeen(event.sessionId);
          }
        } else if (status) {
          updateSessionActivity(
            queryClient,
            event.sessionId,
            status,
            pathname === `/app/task/${event.sessionId}`,
          );
        }
      } else {
        // A session created in another tab (or this one) — pull the new row in.
        scheduleInvalidate();
      }
    }
  });

  const loadMore = useCallback(async () => {
    if (isFetchingNextPage || !hasNextPage) return;
    const result = await fetchNextPage();
    if (result.isError) {
      captureException(result.error, { op: 'task-list-load-more' });
      toast.error('Couldn’t load older tasks. Try again.');
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // Derive the rendered list: favorites floated to the top. The server already
  // returns pinned-first / newest-pin-first; we re-sort the pinned group by
  // favoritedAt DESC only, so an OPTIMISTIC pin (favoritedAt stamped locally to
  // now) jumps to the head before the server echo lands. Unfavorited rows —
  // including a just-created optimistic row, which sits at the front of the
  // cache and is stamped now — keep the cache order untouched.
  const pinnedFirst = items
    .filter((s) => s.favoritedAt)
    .sort((a, b) => (b.favoritedAt?.getTime() ?? 0) - (a.favoritedAt?.getTime() ?? 0));
  const unpinned = items.filter((s) => !s.favoritedAt);
  const tasks = [...pinnedFirst, ...unpinned].map((task) => ({
    ...task,
    title: displaySessionTitle(task.title),
    status: sessionDisplayStatus(task.status, dispatchActivity?.[task.id] === true),
  }));

  // Persist viewing on navigation and each status transition, even when the
  // live cache already says read. No list refetch: it would race this write.
  const activeId = pathname.startsWith('/app/task/') ? (pathname.split('/')[3] ?? null) : null;
  useBackgroundSessionStreams(
    tasks
      .filter(
        (task) =>
          task.id !== activeId && (task.status === 'running' || task.status === 'rescheduling'),
      )
      .map((task) => task.id),
    organizationId,
  );
  const activeTask = activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null;
  const activeUnread = activeTask?.unread ?? false;
  const activeEventAt = activeTask?.lastEventAt?.getTime() ?? null;
  useEffect(() => {
    if (activeId && (activeUnread || activeEventAt !== null)) markSeen(activeId);
  }, [activeId, activeUnread, activeEventAt, markSeen]);

  return {
    tasks,
    loadMore,
    loadingMore: isFetchingNextPage,
    hasMore: hasNextPage,
  };
}

export type TaskListActions = Pick<
  ReturnType<typeof useSessionMutations>,
  'rename' | 'setFavorited' | 'remove'
>;
