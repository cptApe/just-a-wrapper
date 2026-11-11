'use client';

import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { useLoadMoreSentinel } from '@/hooks/use-load-more-sentinel';
import { memoryQueryKeys } from '../api/keys';
import type { MemorySurfaceInitial } from '../api/surface';
import { useMemoryBrowse, useMemoryTrash } from '../api/use-memory-lists';
import { memoryBrowserState } from '../lib/memory-browser-state';
import { NOTE_ROOT } from '../lib/notes';
import type { MemoryScope } from '../types';

export function useMemoryBrowser({
  initial,
  scope,
  storePath,
  inTrash,
  atRoot,
  access,
}: {
  initial: MemorySurfaceInitial;
  scope: MemoryScope | null;
  storePath: string;
  inTrash: boolean;
  atRoot: boolean;
  access: MemorySurfaceInitial['access']['you'] | null;
}) {
  const organizationId = useOrganizationId() ?? 'unscoped';
  const queryClient = useQueryClient();
  const ready = access?.ready ?? false;

  // A seed belongs only to its scope and root browse view; using it elsewhere would display
  // another folder or store as if it were the current one.
  const seedPage =
    initial.initial !== null &&
    initial.initial.scope === scope &&
    storePath === NOTE_ROOT &&
    !inTrash
      ? initial.initial.page
      : null;

  const browse = useMemoryBrowse({
    organizationId,
    scope: scope ?? 'you',
    folderPath: storePath,
    enabled: !atRoot && !inTrash && ready,
    initialPage: seedPage,
  });
  const trashList = useMemoryTrash({
    organizationId,
    scope: scope ?? 'you',
    enabled: !atRoot && inTrash && ready,
  });

  // Identifies the view so switching scope, folder or trash clears selection.
  const activeKey = atRoot ? null : `${scope}:${storePath}:${inTrash ? 'trash' : 'browse'}`;

  // Reconcile the whole drive: retry after an error, and the post-mutation
  // settle for the pane's own writes (create / rename / restore / bulk delete).
  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: memoryQueryKeys.all(organizationId) });
  }, [queryClient, organizationId]);

  const current = React.useMemo(
    () =>
      memoryBrowserState(
        {
          isError: browse.query.isError,
          hasData: browse.query.data !== undefined,
          hasNextPage: browse.query.hasNextPage,
          isFetchingNextPage: browse.query.isFetchingNextPage,
          notes: browse.notes,
          folders: browse.folders,
        },
        {
          isError: trashList.query.isError,
          hasData: trashList.query.data !== undefined,
          hasNextPage: trashList.query.hasNextPage,
          isFetchingNextPage: trashList.query.isFetchingNextPage,
          items: trashList.items,
        },
        { atRoot, inTrash },
      ),
    [
      browse.query.isError,
      browse.query.data,
      browse.query.hasNextPage,
      browse.query.isFetchingNextPage,
      browse.notes,
      browse.folders,
      trashList.query.isError,
      trashList.query.data,
      trashList.query.hasNextPage,
      trashList.query.isFetchingNextPage,
      trashList.items,
      atRoot,
      inTrash,
    ],
  );
  const activeQuery = inTrash ? trashList.query : browse.query;
  const { fetchNextPage } = activeQuery;
  const loadMore = React.useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const sentinelRef = useLoadMoreSentinel<HTMLDivElement>({
    canLoadMore: activeQuery.hasNextPage && !activeQuery.isFetchingNextPage,
    loadMore,
  });
  return { current, invalidate, sentinelRef, activeKey };
}
