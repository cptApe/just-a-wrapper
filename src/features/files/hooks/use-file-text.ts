// Explicit loading, error and success states prevent a blank flash.
'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { fetchText } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { fileQueryKeys } from '../api/keys';

// Use the authenticated byte route so text previews do not depend on cross-origin fetches.
// Cache by the complete URL, including the share token, to keep authorization scopes separate.
export type FileTextState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; text: string };

export function useFileText(url: string): FileTextState {
  const organizationId = useOrganizationId();
  const query = useQuery({
    // The raw url is the cache identity — two spellings of one url caching
    // separately is fine; a false hit is not, so it is never normalized.
    queryKey:
      organizationId !== null
        ? fileQueryKeys.text(organizationId, url)
        : fileQueryKeys.sharedText(url),
    queryFn: ({ signal }) => fetchText(`${url}${url.includes('?') ? '&' : '?'}text=1`, { signal }),
  });

  useEffect(() => {
    if (query.isError) captureException(query.error, { url, op: 'file-text' });
  }, [query.isError, query.error, url]);

  if (query.isError) {
    return {
      kind: 'error',
      message: 'Couldn’t load this file’s content. Try downloading it instead.',
    };
  }
  if (query.data === undefined) return { kind: 'loading' };
  return { kind: 'success', text: query.data };
}
