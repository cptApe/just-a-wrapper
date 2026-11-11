'use client';

import { type QueryClient, useQuery } from '@tanstack/react-query';
import { useOrganizationId } from '@/components/providers/app-providers';
import { IntegrationError } from '@/lib/errors';
import { captureException } from '@/lib/observability-client';
import type { IntegrationView, TesterNotice } from '../types';
import { refreshIntegration } from './connections';
import { integrationQueryKeys } from './keys';

const CHECK_FAILED: TesterNotice = {
  tone: 'error',
  title: 'Couldn’t check',
  body: 'The status check didn’t go through. Try again.',
};

/** The server answered the status read with a notice instead of a view. */
class IntegrationNoticeError extends IntegrationError {
  declare readonly notice: TesterNotice;
  constructor(notice: TesterNotice) {
    super('EXTERNAL_API_FAILED', notice.title, { expectedState: true });
    this.notice = notice;
    this.name = 'IntegrationNoticeError';
  }
}

/** The notice a failed status read shows: the server's own, or the generic check failure. */
export function statusNotice(error: unknown): TesterNotice {
  return error instanceof IntegrationNoticeError ? error.notice : CHECK_FAILED;
}

// Status is never kept across opens: every open reads it again (gcTime 0), and each flow forces
// its own reads through readIntegrationStatus.
function integrationStatusQuery(organizationId: string, slug: string) {
  return {
    queryKey: integrationQueryKeys.status(organizationId, slug),
    queryFn: async (): Promise<IntegrationView> => {
      let result: Awaited<ReturnType<typeof refreshIntegration>>;
      try {
        result = await refreshIntegration(slug);
      } catch (error) {
        captureException(error, { op: 'refresh-integration', slug });
        throw error;
      }
      if (result.status === 'notice') throw new IntegrationNoticeError(result.notice);
      return result.view;
    },
    gcTime: 0,
    retry: false,
  };
}

/** One toolkit's live connection status, shared by the panel and both sign-in flows. */
export function useIntegrationStatus(slug: string) {
  const organizationId = useOrganizationId() ?? 'unscoped';
  return { organizationId, query: useQuery(integrationStatusQuery(organizationId, slug)) };
}

/** Read the status again now; the view lands in the shared cache. */
export async function readIntegrationStatus(
  client: QueryClient,
  organizationId: string,
  slug: string,
): Promise<{ view: IntegrationView; notice: null } | { view: null; notice: TesterNotice }> {
  // A failed read was already reported by the query function; here it becomes the notice to show.
  return client.fetchQuery({ ...integrationStatusQuery(organizationId, slug), staleTime: 0 }).then(
    (view) => ({ view, notice: null }),
    (error: unknown) => ({ view: null, notice: statusNotice(error) }),
  );
}
