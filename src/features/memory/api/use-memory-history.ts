'use client';
import {
  queryOptions,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { useOrganizationId } from '@/components/providers/app-providers';
import { captureException } from '@/lib/observability-client';
import { FIRST_PAGE, unwrapMemoryResult } from '../lib/memory-cache';
import type { MemoryNote, MemoryNoteVersion } from '../lib/notes';
import type { MemoryScope } from '../types';
import {
  loadMemoryNoteVersions,
  previewMemoryNoteVersion,
  restoreMemoryNoteVersion,
} from './actions';
import { memoryQueryKeys } from './keys';

function versionPreviewQuery(organizationId: string, scope: MemoryScope, id: string | null) {
  return queryOptions({
    queryKey: memoryQueryKeys.version(organizationId, scope, id),
    queryFn:
      id === null
        ? skipToken
        : async () => unwrapMemoryResult(await previewMemoryNoteVersion(scope, id)),
  });
}

export function useMemoryHistory(scope: MemoryScope, note: MemoryNote, onRestored: () => void) {
  const organizationId = useOrganizationId() ?? 'unscoped';
  const noteId = note.id;
  const query = useInfiniteQuery({
    queryKey: memoryQueryKeys.versions(organizationId, scope, noteId),
    queryFn: async ({ pageParam }) =>
      unwrapMemoryResult(await loadMemoryNoteVersions(scope, noteId, pageParam)),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 0,
    retry: false,
  });
  const [previewId, setPreviewId] = useState<string | null>(null);

  const previewQuery = useQuery(versionPreviewQuery(organizationId, scope, previewId));
  const preview = previewQuery.data ?? null;

  const restoration = useMutation({
    mutationFn: async (version: MemoryNoteVersion) =>
      unwrapMemoryResult(
        await restoreMemoryNoteVersion(scope, noteId, version.id, {
          contentSha256: note.contentSha256,
        }),
      ),
    onSuccess: () => {
      toast.success('Version restored');
      onRestored();
    },
    onError: (error) => {
      captureException(error, { op: 'memory-version-restore', noteId });
      toast.error('Couldn’t restore this version', { description: error.message });
    },
  });
  function openPreview(version: MemoryNoteVersion) {
    setPreviewId(version.id);
  }
  function restore(version: MemoryNoteVersion) {
    if (!restoration.isPending) restoration.mutate(version);
  }
  return {
    query,
    preview,
    pending: previewQuery.isFetching || restoration.isPending,
    previewError: previewQuery.isError ? previewQuery.error.message : null,
    actions: { openPreview, restore, closePreview: () => setPreviewId(null) },
  };
}
