'use client';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { useContext } from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { fileQueryKeys } from '@/features/files/api/keys';
import { chatSessionIdFromPath, type FileLinkIndex } from '../lib/file-link';
import { loadFileLinkIndex } from '../lib/file-link-index';

// Public transcripts have no query provider and never fetch private file metadata.
const publicQueryClient = new QueryClient();

export function useFileLinkIndex(enabled: boolean): FileLinkIndex | null {
  const client = useContext(QueryClientContext);
  const organizationId = useOrganizationId();
  const path = typeof window === 'undefined' ? '' : window.location.pathname;
  const sessionId = chatSessionIdFromPath(path);
  const query = useQuery(
    {
      queryKey:
        organizationId === null
          ? fileQueryKeys.unscoped()
          : [...fileQueryKeys.all(organizationId), 'link-index', sessionId],
      queryFn: () => loadFileLinkIndex(sessionId),
      enabled:
        client !== undefined && enabled && organizationId !== null && path.startsWith('/app/'),
      staleTime: 15_000,
    },
    client ?? publicQueryClient,
  );
  return query.data ?? null;
}
