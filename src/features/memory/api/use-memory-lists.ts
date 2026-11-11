'use client';

import { type InfiniteData, useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { FIRST_PAGE, unwrapMemoryResult } from '../lib/memory-cache';
import type { DeletedMemoryNote, MemoryNote } from '../lib/notes';
import type { MemoryNotesPage, MemoryScope } from '../types';
import { loadMemoryBrowsePage, loadMemoryTrash } from './actions';
import { memoryQueryKeys } from './keys';

// Seed only the exact server-rendered folder. Cache-forever queries reconcile on explicit writes
// or retry, so revisiting a folder does not fetch it again.
export function useMemoryBrowse(args: {
  organizationId: string;
  scope: MemoryScope;
  folderPath: string;
  enabled: boolean;
  initialPage: MemoryNotesPage | null;
}) {
  const query = useInfiniteQuery<
    MemoryNotesPage,
    Error,
    InfiniteData<MemoryNotesPage, string | null>,
    readonly string[],
    string | null
  >({
    queryKey: memoryQueryKeys.browse(args.organizationId, args.scope, args.folderPath),
    queryFn: async ({ pageParam }) =>
      unwrapMemoryResult(await loadMemoryBrowsePage(args.scope, args.folderPath, pageParam)),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: args.enabled,
    initialData: () =>
      args.initialPage
        ? ({
            pages: [args.initialPage],
            pageParams: [null],
          } satisfies InfiniteData<MemoryNotesPage, string | null>)
        : undefined,
  });

  const notes: MemoryNote[] = useMemo(
    () => query.data?.pages.flatMap((page) => page.notes) ?? [],
    [query.data],
  );
  // Folders repeat across pages (they're re-derived per page) — union them.
  const folders: string[] = useMemo(
    () => [...new Set(query.data?.pages.flatMap((page) => page.folders) ?? [])],
    [query.data],
  );

  return { query, notes, folders };
}

/** One store's Recently-deleted list, cursor-paginated. */
export function useMemoryTrash(args: {
  organizationId: string;
  scope: MemoryScope;
  enabled: boolean;
}) {
  const query = useInfiniteQuery({
    queryKey: memoryQueryKeys.trash(args.organizationId, args.scope),
    queryFn: async ({ pageParam }) =>
      unwrapMemoryResult(await loadMemoryTrash(args.scope, pageParam)),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: args.enabled,
  });

  const items: DeletedMemoryNote[] = useMemo(
    () => query.data?.pages.flatMap((page) => page.notes) ?? [],
    [query.data],
  );

  return { query, items };
}
