'use client';

import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { AppError } from '@/lib/errors';
import { filesQueryKey, type LibraryFilesQuery } from '../lib/library-items';
import type { FileEntry, FolderEntry } from '../types';
import { fileQueryKeys } from './keys';
import { loadLibraryFilesPage } from './list-items';
import type { LibraryFilesPage } from './load';

// The Files tab's paginated list as an infinite query, the
// exact shape as the sidebar Recents (`features/sessions/api/use-session-list`):
// the server component renders the authoritative FIRST page for the url's query
// and passes it as a prop; that page seeds `initialData`, so mount paints the
// real list with no client fetch and no flash. Load-more appends offset pages
// through the same server action the page uses. staleTime is Infinity (the
// shared client default), so returning to a query already loaded — a folder
// re-open, a tab round-trip — paints from cache with zero network. A filter
// change is a new query key; `placeholderData` holds the current list on screen
// until the new page lands, so the pane never blanks between filters — but only
// within the SAME folder. Navigating to a different `path` must never render
// the previous folder's rows (they'd read as the new folder's contents), so a
// path change with no cache for the target shows the pending skeleton instead.
//
// `offset` is the page param: each page's `offset` is the count of every file
// loaded so far (matching the server action's own offset contract).

type FilesQuery = Omit<LibraryFilesQuery, 'offset'>;

// Stable empty fallback so consumers memoizing on `deletedFolders` don't churn
// when a query carries none (the common, non-trash case).
const NO_DELETED_FOLDERS: FolderEntry[] = [];

async function fetchFilesPage(query: FilesQuery, offset: number): Promise<LibraryFilesPage> {
  const res = await loadLibraryFilesPage({ ...query, offset });
  if (!res.ok) {
    throw new AppError('API_REQUEST_FAILED', 'Library files page failed to load', {
      serverMessage: res.message,
    });
  }
  return res.data;
}

export function useLibraryFiles(input: {
  organizationId: string;
  query: FilesQuery;
  initialPage: LibraryFilesPage;
  /** filesQueryKey of the query the server rendered `initialPage` for. */
  initialQueryKey: string;
}): {
  files: FileEntry[];
  deletedFolders: FolderEntry[];
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  loading: boolean;
  errored: boolean;
} {
  const queryClient = useQueryClient();
  const params = filesQueryKey(input.query);
  // The server always renders `initialPage` for the current url's query, so a
  // fresh navigation seeds page 0; a client-side filter change diverges the key
  // and fetches (with the previous list kept on screen).
  const seeded = params === input.initialQueryKey;

  // Any mutation — including ones dispatched OUTSIDE this pane (New Note, other
  // library actions) — refreshes by re-rendering the RSC (router.refresh()),
  // which hands down a fresh `initialPage`. `initialData` can't propagate that
  // (React Query never lets it overwrite an existing cache entry), so whenever
  // the server sends a new page 0 for the current query, write it into the cache.
  // The write resets to page 0 because a refresh supersedes scrolled-in client pages.
  useEffect(() => {
    if (params !== input.initialQueryKey) return;
    queryClient.setQueryData<InfiniteData<LibraryFilesPage, number>>(
      fileQueryKeys.list(input.organizationId, params),
      { pages: [input.initialPage], pageParams: [0] },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only when the RSC hands down a fresh initialPage
  }, [input.initialPage]);

  const query = useInfiniteQuery({
    queryKey: fileQueryKeys.list(input.organizationId, params),
    queryFn: ({ pageParam }) => fetchFilesPage(input.query, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.reduce((total, page) => total + page.files.length, 0) : undefined,
    initialData: () =>
      seeded
        ? ({ pages: [input.initialPage], pageParams: [0] } satisfies InfiniteData<
            LibraryFilesPage,
            number
          >)
        : undefined,
    // Folder identity for `placeholderData`: `previousQuery.meta` is the only
    // way the callback can tell "same folder, new filter" from "new folder".
    meta: { path: input.query.path },
    // Keep the previous list on screen across a filter/sort/search change
    // (same folder — no blank flash), but never across a folder change: the
    // old folder's rows under a new folder read as wrong contents. With no
    // placeholder the query is pending, so the pane shows its skeleton; a
    // folder already in cache still paints instantly from its own entry.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.meta?.path === input.query.path ? previousData : undefined,
  });

  const files = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.files),
    [query.data],
  );
  // Deleted subtree-roots ride only on the first page (trash mode).
  const deletedFolders = query.data?.pages[0]?.deletedFolders ?? NO_DELETED_FOLDERS;

  // Stable identity — the infinite-scroll sentinel effect keys its observer on
  // this. fetchNextPage no-ops when there is no next page or one is in flight.
  const { fetchNextPage } = query;
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  return {
    files,
    deletedFolders,
    hasMore: query.hasNextPage,
    loadMore,
    loadingMore: query.isFetchingNextPage,
    // A full skeleton only when there is genuinely no list to show yet (no
    // seed, no kept-previous list). A same-folder filter change keeps the
    // previous list via placeholderData so it never trips this; an uncached
    // folder navigation intentionally does.
    loading: query.isPending,
    errored: query.isError,
  };
}
