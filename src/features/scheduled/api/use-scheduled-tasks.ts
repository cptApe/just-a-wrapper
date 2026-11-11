'use client';

// RSC seeds both Tasks and Calendar without a second fetch. There is no GET list endpoint.
// The effect reconciles an explicit server refresh into the shared list cache.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { TaskScheduledItem } from '@/features/tasks/types';
import { AppError } from '@/lib/errors';
import { scheduledQueryKeys } from './keys';

async function noListEndpoint(): Promise<TaskScheduledItem[]> {
  throw new AppError(
    'UNEXPECTED',
    'The scheduled list has no GET endpoint; the cache is seeded from the RSC and never refetched.',
  );
}

export function useScheduledTasks(input: {
  organizationId: string;
  initialTasks: TaskScheduledItem[];
}): TaskScheduledItem[] {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: scheduledQueryKeys.list(input.organizationId),
    queryFn: noListEndpoint,
    initialData: input.initialTasks,
  });

  useEffect(() => {
    queryClient.setQueryData(scheduledQueryKeys.list(input.organizationId), input.initialTasks);
  }, [input.initialTasks, input.organizationId, queryClient]);

  return query.data;
}

/** Reads the list the Scheduled page seeded, without ever fetching it. It keeps
 * the page's query function, so any refetch the cache starts while an overlay
 * holds this observer still fails loudly instead of losing its function. */
export function useCachedScheduledTasks(
  organizationId: string | null,
): TaskScheduledItem[] | undefined {
  const query = useQuery({
    queryKey:
      organizationId !== null
        ? scheduledQueryKeys.list(organizationId)
        : scheduledQueryKeys.unscoped(),
    queryFn: noListEndpoint,
    enabled: false,
  });
  return query.data;
}
