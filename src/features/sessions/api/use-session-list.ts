'use client';

import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import { sessionListItemSchema } from '../lib/session-list-item-schema';
import type { WorkspaceSessionListItem } from '../types';
import { sessionQueryKeys } from './keys';
import { preservePendingSessionSends } from './session-live-cache';

// Seed the query with the server first page to avoid a duplicate mount fetch. Realtime and
// mutations explicitly invalidate the workspace cache.
export type SessionsPage = { items: WorkspaceSessionListItem[]; nextCursor: string | null };

// GET /api/sessions serializes Dates as ISO strings — parse + revive at the
// boundary (parse, don't validate) so fetched pages carry the same shape the
// server-rendered first page does.
const SessionsPageSchema = z.object({
  items: z.array(sessionListItemSchema),
  nextCursor: z.string().nullable(),
});

async function fetchSessionsPage(
  cursor: string | null,
  signal: AbortSignal,
): Promise<SessionsPage> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const body = await fetchJson(`/api/sessions${qs}`, { signal });
  const parsed = SessionsPageSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('UNEXPECTED', 'Task list returned an unexpected response.');
  }
  return parsed.data;
}

export function useSessionList(input: {
  organizationId: string;
  initialItems: WorkspaceSessionListItem[];
  initialCursor: string | null;
}) {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: sessionQueryKeys.list(input.organizationId),
    queryFn: async ({ pageParam, signal }: { pageParam: string | null; signal: AbortSignal }) =>
      preservePendingSessionSends(queryClient, await fetchSessionsPage(pageParam, signal)),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialData: {
      pages: [{ items: input.initialItems, nextCursor: input.initialCursor }],
      pageParams: [null],
    } satisfies InfiniteData<SessionsPage, string | null>,
  });

  // Flatten pages, dedup by id (first occurrence wins) so a row that migrated up
  // into an earlier page on refetch never renders twice.
  const items = useMemo(() => {
    const seen = new Set<string>();
    const flat: WorkspaceSessionListItem[] = [];
    for (const page of query.data.pages) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        flat.push(item);
      }
    }
    return flat;
  }, [query.data]);

  return {
    items,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}
