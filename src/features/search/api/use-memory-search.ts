'use client';

import { useQuery } from '@tanstack/react-query';
import { useOrganizationId } from '@/components/providers/app-providers';
import { AppError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import { SEARCH_GC_TIME_MS, SEARCH_STALE_TIME_MS, searchQueryKeys } from '@/lib/search-query-keys';
import { normalizeQuery } from '../lib/match';
import { SearchResponseSchema, type ServerSearchResult } from '../types';

// Mirrors the route's zod max, so a long paste searches its first 200 characters.
const MAX_QUERY_LENGTH = 200;

async function fetchMemoryResults(
  query: string,
  signal: AbortSignal,
): Promise<ServerSearchResult[]> {
  const body = await fetchJson(`/api/search?group=memory&q=${encodeURIComponent(query)}`, {
    signal,
  });
  const parsed = SearchResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      'UNEXPECTED',
      'Memory search returned an unexpected response.',
      { query },
      { cause: parsed.error },
    );
  }
  return parsed.data.results;
}

/** Every note in both memory stores whose path holds the query. The caller debounces the text. */
export function useMemorySearch(rawQuery: string) {
  const organizationId = useOrganizationId();
  const query = normalizeQuery(rawQuery).slice(0, MAX_QUERY_LENGTH);
  const active = query !== '' && organizationId !== null;
  return useQuery({
    queryKey: active ? searchQueryKeys.memory(organizationId, query) : searchQueryKeys.unscoped(),
    queryFn: ({ signal }) => fetchMemoryResults(query, signal),
    enabled: active,
    staleTime: SEARCH_STALE_TIME_MS,
    gcTime: SEARCH_GC_TIME_MS,
  });
}
