'use client';

import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { subscribeCachedQuery } from '@/lib/subscribe-cached-query';
import { sessionQueryKeys } from './keys';
import type { SessionsPage } from './use-session-list';

type CachedSessionList = InfiniteData<SessionsPage, string | null>;

const noSubscription = () => () => undefined;
const noServerSnapshot = () => undefined;

/** Reads the sidebar's list cache without owning or refetching it. */
export function useCachedSessionList(organizationId: string | null): CachedSessionList | undefined {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) =>
      organizationId === null
        ? noSubscription()
        : subscribeCachedQuery(queryClient, sessionQueryKeys.list(organizationId), onChange),
    [queryClient, organizationId],
  );
  const getSnapshot = useCallback(
    () =>
      organizationId === null
        ? undefined
        : queryClient.getQueryData<CachedSessionList>(sessionQueryKeys.list(organizationId)),
    [queryClient, organizationId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, noServerSnapshot);
}
