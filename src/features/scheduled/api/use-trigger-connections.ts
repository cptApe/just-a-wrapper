'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
// Import the server action directly so server-only siblings never enter the client bundle.
import { getIntegrations } from '@/features/integrations/api/connections';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability-client';
import { scheduledQueryKeys } from './keys';

export function useTriggerConnections() {
  const organizationId = useOrganizationId();
  const query = useQuery({
    queryKey: organizationId
      ? scheduledQueryKeys.connections(organizationId)
      : scheduledQueryKeys.unscoped(),
    enabled: organizationId !== null,
    // Connections can change in Plugins while the schedule dialog is closed.
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const response = await getIntegrations();
      if (response.status !== 'ok')
        throw new AppError('API_REQUEST_FAILED', 'Couldn’t load connected apps', {
          status: response.status,
        });
      return new Map(
        response.integrations
          // Triggers attach to the member's own account, never the workspace's.
          .filter((connection) => connection.ownConnected)
          .map((connection) => [connection.slug, connection]),
      );
    },
  });
  useEffect(() => {
    if (query.error) captureException(query.error, { op: 'load-event-integrations' });
  }, [query.error]);
  const state =
    query.isFetching || (query.isPending && query.fetchStatus !== 'idle')
      ? { kind: 'loading' as const }
      : query.isError || query.isPending
        ? { kind: 'error' as const }
        : { kind: 'ready' as const, connected: query.data };
  return { state, retry: query.refetch };
}
