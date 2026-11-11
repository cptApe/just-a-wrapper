'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer } from 'react';
import { z } from 'zod';
import { useOrganizationId } from '@/components/providers/app-providers';
import { fetchJson } from '@/lib/fetch-json';
import { artifactQueryKeys } from '../api/keys';
import { artifactRefreshReducer } from '../lib/artifact-refresh-machine';
import type { ArtifactSummary } from '../types';

// Late indexing receives two bounded refreshes after the session settles.
const LATE_REFRESH_AT_MS = [7000, 25000];

const artifactSummarySchema = z.object({
  id: z.string(),
  anthropicFileId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  downloadable: z.boolean(),
  savedDriveFileId: z.string().nullable(),
  createdAt: z.string(),
});
const listResponseSchema = z.object({ artifacts: z.array(artifactSummarySchema) });

async function fetchArtifactList(
  sessionId: string,
  refresh: boolean,
  signal: AbortSignal,
): Promise<ArtifactSummary[]> {
  const body = await fetchJson(
    `/api/sessions/${sessionId}/artifacts${refresh ? '?refresh=1' : ''}`,
    { signal },
  );
  return listResponseSchema.parse(body).artifacts;
}

export type SessionArtifactsState = {
  phase: 'loading' | 'success' | 'error';
  /** Last good list — kept through errors/refreshes so cards never flicker away. */
  artifacts: ArtifactSummary[];
};

export function useSessionArtifacts(
  sessionId: string,
  signals: { status: string | null; artifactSignal: number },
): {
  state: SessionArtifactsState;
  retry: () => void;
  markSaved: (artifactId: string, savedDriveFileId: string) => void;
} {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const [refreshState, dispatch] = useReducer(artifactRefreshReducer, {
    status: signals.status,
    signal: signals.artifactSignal,
    revision: 0,
    idleEpoch: 0,
  });
  if (refreshState.status !== signals.status || refreshState.signal !== signals.artifactSignal) {
    dispatch({ type: 'observe', status: signals.status, signal: signals.artifactSignal });
  }
  const query = useQuery({
    queryKey:
      organizationId !== null
        ? artifactQueryKeys.session(organizationId, sessionId)
        : artifactQueryKeys.unscoped(),
    queryFn: async ({ signal, queryKey }) => {
      // Sweep on every fetch except the cache's first-ever population.
      const refresh = refreshState.revision > 0 || queryClient.getQueryData(queryKey) !== undefined;
      return fetchArtifactList(sessionId, refresh, signal);
    },
    enabled: organizationId !== null,
  });

  useEffect(() => {
    if (organizationId === null || refreshState.revision === 0) return;
    void queryClient.invalidateQueries({
      queryKey: artifactQueryKeys.session(organizationId, sessionId),
    });
  }, [organizationId, sessionId, queryClient, refreshState.revision]);

  useEffect(() => {
    if (refreshState.idleEpoch === 0) return;
    const timers = LATE_REFRESH_AT_MS.map((delay) =>
      setTimeout(() => dispatch({ type: 'retry' }), delay),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [refreshState.idleEpoch]);
  const retry = useCallback(() => dispatch({ type: 'retry' }), []);

  const markSaved = useCallback(
    (artifactId: string, savedDriveFileId: string) => {
      if (organizationId === null) return;
      queryClient.setQueryData<ArtifactSummary[]>(
        artifactQueryKeys.session(organizationId, sessionId),
        (prev) => prev?.map((a) => (a.id === artifactId ? { ...a, savedDriveFileId } : a)),
      );
    },
    [queryClient, organizationId, sessionId],
  );

  // `error` is the LATEST settled fetch's error (null once a fetch succeeds), so
  // it flips to the error phase on any failed read while keeping the last good
  // list.
  const hasError = query.error !== null;
  const state: SessionArtifactsState =
    query.data !== undefined
      ? { phase: hasError ? 'error' : 'success', artifacts: query.data }
      : { phase: hasError ? 'error' : 'loading', artifacts: [] };

  return { state, retry, markSaved };
}
