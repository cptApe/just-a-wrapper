'use client';

import type { QueryClient } from '@tanstack/react-query';
import { searchQueryKeys } from '@/lib/search-query-keys';
import { sessionQueryKeys } from './keys';

const REFRESH_DEBOUNCE_MS = 1000;

// One debounced reconcile is shared by realtime and mutation onSettled paths, so a send refetches once.
// The browser QueryClient is a singleton; call sites share this module-scoped timer.
const pending = new WeakMap<QueryClient, Set<string>>();

export function scheduleSessionListInvalidate(
  queryClient: QueryClient,
  organizationId: string,
): void {
  // Expire search immediately, including inactive query texts. Sidebar refreshes
  // remain debounced, but reopening search after an edit must not trust old data.
  void queryClient.invalidateQueries({ queryKey: searchQueryKeys.all(organizationId) });
  let organizations = pending.get(queryClient);
  if (!organizations) {
    organizations = new Set();
    pending.set(queryClient, organizations);
  }
  if (organizations.has(organizationId)) return;
  organizations.add(organizationId);
  setTimeout(() => {
    // Delete (not flip-to-false) so the map never retains dead organization keys.
    organizations.delete(organizationId);
    void queryClient.invalidateQueries({ queryKey: sessionQueryKeys.all(organizationId) });
  }, REFRESH_DEBOUNCE_MS);
}
