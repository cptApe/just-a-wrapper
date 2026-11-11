'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { fetchJson } from '@/lib/fetch-json';
import { libraryFilesSchema } from '@/lib/file-response-schema';
import { captureException } from '@/lib/observability-client';
import { chatQueryKeys } from '../api/keys';

export function useChatLibraryFiles(enabled: boolean, resource: string) {
  const organizationId = useOrganizationId();
  const query = useQuery({
    queryKey: chatQueryKeys.library(organizationId, resource),
    queryFn: async ({ signal }) =>
      libraryFilesSchema.parse(await fetchJson('/api/library/items', { signal })).files,
    enabled: enabled && organizationId !== null,
  });
  useEffect(() => {
    if (query.error) captureException(query.error, { op: 'chat-library-lookup' });
  }, [query.error]);
  return query;
}
