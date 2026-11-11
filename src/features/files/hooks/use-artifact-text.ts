'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { fetchText } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { artifactQueryKeys } from '../api/keys';
import { artifactContentUrl } from '../lib/content-url';

// Fetch a text-kind artifact's content through the byte proxy for the
// markdown / code / csv / html views. Cached under the artifact key root
// keyed by artifact id, so reopening the same artifact paints
// instantly with no re-download. Explicit state machine — the viewer renders
// loading, error, and success branches, never a blank flash.

export type ArtifactTextState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; text: string };

export function useArtifactText(artifactId: string): ArtifactTextState {
  const organizationId = useOrganizationId();
  const query = useQuery({
    queryKey:
      organizationId !== null
        ? artifactQueryKeys.text(organizationId, artifactId)
        : artifactQueryKeys.unscoped(),
    queryFn: ({ signal }) => fetchText(artifactContentUrl(artifactId), { signal }),
    enabled: organizationId !== null,
  });

  useEffect(() => {
    if (query.isError) captureException(query.error, { artifactId, op: 'artifact-text' });
  }, [query.isError, query.error, artifactId]);

  if (query.isError) {
    return {
      kind: 'error',
      message: 'Couldn’t load this file’s content. Try downloading it instead.',
    };
  }
  if (query.data === undefined) return { kind: 'loading' };
  return { kind: 'success', text: query.data };
}
