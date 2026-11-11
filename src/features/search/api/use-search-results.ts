'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { sessionQueryKeys } from '@/features/sessions/api/keys';
import { useCachedSessionList } from '@/features/sessions/api/use-cached-session-list';
import { AppError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { SEARCH_GC_TIME_MS, SEARCH_STALE_TIME_MS, searchQueryKeys } from '@/lib/search-query-keys';
import { normalizeQuery } from '../lib/match';
import { recentSearchTasks } from '../lib/result-list';
import { matchCachedTaskTitles, mergeSearchResults } from '../lib/task-results';
import { SearchResponseSchema, type SearchState, type ServerSearchResult } from '../types';

const DEBOUNCE_MS = 250;
/** Mirrors the route's zod max — capped here so a long paste searches on its
    first 200 chars instead of surfacing a 400 as the generic error state. */
const MAX_QUERY_LENGTH = 200;

// GET /api/search?q= — parse + throw at the boundary. React Query owns
// cancellation (the signal it passes is wired to fetch), so there is no
// hand-rolled AbortController here.
async function fetchSearchResults(
  query: string,
  signal: AbortSignal,
): Promise<ServerSearchResult[]> {
  const body = await fetchJson(`/api/search?q=${encodeURIComponent(query)}`, { signal });
  const parsed = SearchResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      'UNEXPECTED',
      'Search returned an unexpected response.',
      { query },
      { cause: parsed.error },
    );
  }
  return parsed.data.results;
}

// Task titles stream from the already-seeded sidebar cache immediately. The
// debounced, cancellable /api/search request remains the only request and fills
// in older task/message matches plus Library and the other server groups.
export function useSearchResults(
  query: string,
  enabled: boolean,
): { state: SearchState; recent: ServerSearchResult[]; retry: () => void } {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const q = normalizeQuery(query).slice(0, MAX_QUERY_LENGTH);
  const cachedSessions = useCachedSessionList(organizationId);
  const sessionItems = useMemo(
    () => cachedSessions?.pages.flatMap((page) => page.items) ?? [],
    [cachedSessions],
  );
  const cachedTaskResults = useMemo(
    () => (enabled ? matchCachedTaskTitles(sessionItems, q) : []),
    [sessionItems, enabled, q],
  );

  // Debounce the text that actually drives the fetch key; the live `q` still
  // gates idle/enabled so clearing the box returns to idle instantly.
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [q]);

  // A null workspace (segment resolve failed) must never key results — that would
  // bucket every workspace under one entry. Fold it into the active gate and use
  // the inert unscoped key so the query stays disabled instead.
  const active = enabled && q !== '' && debounced !== '' && organizationId !== null;
  const { data, error, isError, refetch } = useQuery({
    queryKey: active
      ? searchQueryKeys.results(organizationId, debounced)
      : searchQueryKeys.unscoped(),
    queryFn: ({ signal }) => fetchSearchResults(debounced, signal),
    enabled: active,
    staleTime: SEARCH_STALE_TIME_MS,
    gcTime: SEARCH_GC_TIME_MS,
  });

  // Opening expires cached search text even with an empty box.
  // Keep any request already started by enabling this observer.
  useEffect(() => {
    if (enabled && organizationId !== null) {
      void queryClient.invalidateQueries(
        { queryKey: searchQueryKeys.all(organizationId) },
        { cancelRefetch: false },
      );
      // Deletes in another tab have no realtime event. Refresh Recents too so
      // its immediate matches cannot keep a remotely deleted task in search.
      void queryClient.invalidateQueries(
        { queryKey: sessionQueryKeys.all(organizationId) },
        { cancelRefetch: false },
      );
    }
  }, [enabled, organizationId, queryClient]);

  // Report failed requests while the menu renders its retry state.
  useEffect(() => {
    if (isError) captureException(error, { op: 'command-search', feature: 'search' });
  }, [isError, error]);

  let state: SearchState;
  if (!enabled || q === '') {
    state = { kind: 'idle' };
  } else if (debounced !== q) {
    state = { kind: 'loading', results: cachedTaskResults };
  } else if (isError) {
    state = {
      kind: 'error',
      message: 'Search is not responding right now. Please try again.',
      results: cachedTaskResults,
    };
  } else if (data === undefined) {
    state = { kind: 'loading', results: cachedTaskResults };
  } else {
    state = { kind: 'success', results: mergeSearchResults(cachedTaskResults, data) };
  }

  return {
    state,
    recent: recentSearchTasks(sessionItems),
    retry: () => void refetch(),
  };
}
