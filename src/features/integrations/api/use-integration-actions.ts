'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { captureException } from '@/lib/observability-client';
import type { IntegrationActionView, TesterNotice } from '../types';
import { integrationQueryKeys } from './keys';
import { getIntegrationActions } from './toolkit-actions';

// Cache successful action lists for the session within the active workspace.
// Notices stay stale and errors retry on remount, so failures are not sticky.
// The four-state result drives the modal; see docs/spec/03-patterns.md §2.

export type IntegrationActionsState =
  | { kind: 'loading' }
  | { kind: 'error'; notice: TesterNotice }
  | { kind: 'success'; actions: IntegrationActionView[]; totalCount: number };

export function useIntegrationActions(slug: string): IntegrationActionsState {
  const organizationId = useOrganizationId();

  const { data, error, isError } = useQuery({
    // A null workspace (segment resolve failed) must never key the actions — that
    // would bucket every workspace under one entry. Gate the query off and use the
    // inert unscoped key so nothing executes or caches under a shared bucket.
    queryKey:
      organizationId !== null
        ? integrationQueryKeys.actions(organizationId, slug)
        : integrationQueryKeys.unscoped(slug),
    queryFn: () => getIntegrationActions(slug),
    enabled: organizationId !== null,
    // Only a successful read is cached forever; a notice stays stale so the next
    // open retries.
    staleTime: (query) => (query.state.data?.status === 'ok' ? Number.POSITIVE_INFINITY : 0),
    // A notice / unauth is deterministic — retrying immediately won't change it;
    // the next modal open retries via refetchOnMount.
    retry: false,
  });

  useEffect(() => {
    if (isError) captureException(error, { op: 'integration-actions', slug });
  }, [isError, error, slug]);

  if (isError) {
    return {
      kind: 'error',
      notice: {
        tone: 'error',
        title: 'Couldn’t load actions',
        body: 'Reading this integration’s actions didn’t go through. Close and try again.',
      },
    };
  }
  if (data === undefined) {
    return { kind: 'loading' };
  }
  if (data.status === 'ok') {
    return { kind: 'success', actions: data.actions, totalCount: data.totalCount };
  }
  return { kind: 'error', notice: data.notice };
}
