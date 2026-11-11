'use client';

import { type QueryFunction, type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

// Prefetch-on-intent. The moment
// a user shows intent to open a row — hovering it, or keyboard-focusing it (Tab)
// — warm that row's detail query so the overlay/dialog it opens is already
// painted, with no loading frame.
//
// `prefetchQuery` uses the client's default staleTime (Infinity here) to decide
// whether the cache is fresh, so it is a no-op when the key already holds an
// entry (r4 TanStack docs): repeated hovers, and hovering a row whose detail is
// already cached, fire NOTHING — the prefetch self-dedupes, no debounce needed.
// A prefetch failure is swallowed by prefetchQuery and never surfaced; the real
// open re-runs the query and renders its own error state. Prefetch is invisible
// by definition — it introduces no spinner and no layout shift.
export function usePrefetchOnIntent(): {
  onIntent: (queryKey: QueryKey, queryFn: QueryFunction) => void;
} {
  const queryClient = useQueryClient();

  const onIntent = useCallback(
    (queryKey: QueryKey, queryFn: QueryFunction) => {
      // retry: false — a hover on a row whose detail errors (e.g. a 404 on a
      // just-deleted row) must not fan out the client's default retries on every
      // hover. The real open re-runs the query and applies the normal retry there.
      void queryClient.prefetchQuery({ queryKey, queryFn, retry: false });
    },
    [queryClient],
  );

  return { onIntent };
}
