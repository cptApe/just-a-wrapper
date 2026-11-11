'use client';

import { useEffect } from 'react';
import { IconFile02, IconSearchMd } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ListRow,
  ListRowContent,
  ListRowGroup,
  ListRowIcon,
  ListRowMeta,
  ListRowTitle,
} from '@/components/ui/list-row';
import { BrowserSkeletons } from '@/features/files/browser';
import { displayFilename } from '@/features/files/lib/file-types';
import { isOverlayHash, openOverlay } from '@/features/overlays';
import { captureException } from '@/lib/observability-client';
import { useMemorySearch } from '../api/use-memory-search';
import type { ServerSearchResult } from '../types';

/** Opens a note over the Memory pane, so the search stays as typed behind it. */
function openResult(result: ServerSearchResult): void {
  const hash = result.href.slice(result.href.indexOf('#') + 1);
  if (isOverlayHash(hash)) openOverlay(hash);
}

/** The Memory pane's search: every note in both stores whose name or folder holds the query. */
export function MemorySearchResults({ query }: { query: string }) {
  const { data, isPending, isError, error, refetch } = useMemorySearch(query);

  useEffect(() => {
    if (isError) captureException(error, { op: 'memory-search', feature: 'search' });
  }, [isError, error]);

  if (isError)
    return (
      <EmptyState
        icon={IconSearchMd}
        title="Couldn’t search memory"
        description="Search is not responding right now."
        action={
          <Button type="button" variant="secondary" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        }
      />
    );
  if (isPending) return <BrowserSkeletons view="list" label="Searching memory" />;
  if (data.length === 0)
    return <EmptyState icon={IconSearchMd} title="No notes match that search" />;
  return (
    <ListRowGroup aria-label="Memory search results">
      {data.map((result) => (
        <li key={result.id}>
          <ListRow asChild>
            <button type="button" onClick={() => openResult(result)}>
              <ListRowIcon>
                <IconFile02 />
              </ListRowIcon>
              <ListRowContent>
                <ListRowTitle>{displayFilename(result.title)}</ListRowTitle>
                {result.subtitle ? <ListRowMeta>{result.subtitle}</ListRowMeta> : null}
              </ListRowContent>
            </button>
          </ListRow>
        </li>
      ))}
    </ListRowGroup>
  );
}
