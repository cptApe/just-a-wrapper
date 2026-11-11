'use client';

import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { PreviewDownloadButton, PreviewSurface } from '@/components/ui/preview-surface';
import { Spinner } from '@/components/ui/spinner';
// Direct artifact-component import (not the barrel — it's server-API-only):
// same precedent as the Library page island.
import { ArtifactViewer } from '@/features/files/components/artifact-viewer';
import { PreviewNotice } from '@/features/files/components/preview-notice';
import { artifactContentUrl } from '@/features/files/lib/content-url';
// Type-only import — erased at compile time, no runtime edge back to the host.
import type { OverlayComponentProps } from '@/features/overlays/types';
import { fetchJson } from '@/lib/fetch-json';
import { libraryItemsSchema } from '@/lib/file-response-schema';
import { captureException } from '@/lib/observability-client';
import { fileQueryKeys } from '../api/keys';
import { downloadUrl } from '../lib/download-url';
import { displayFilename } from '../lib/file-types';
import { itemName, type LibraryArtifact, type LibraryItem } from '../lib/library-items';
import type { FileEntry } from '../types';
import { FilePreview } from './file-preview';

// The file hash overlay loads one item by id and works cold over any app route.
// Ignore underlying view refinements so search or sort cannot change the open file.
// Use the shared preview canvas without sibling navigation.

type ItemsState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; files: FileEntry[]; artifacts: LibraryArtifact[] };

type PreviewableItem = Exclude<LibraryItem, { kind: 'folder' }>;

// The whole-drive read (files + artifacts) the overlay resolves its subject
// from. Cached under the files feature root with a fixed param
// tag, so reopening the preview is zero network — and any Library mutation, which
// invalidates fileQueryKeys.all(organizationId), refreshes this the same as the
// pane. The list is identical for every open; only the hash id (which item to
// show) changes, so nothing about the item drives the key.
const OVERLAY_ITEMS_PARAMS = 'overlay-library-items';

function useLibraryItems(): { state: ItemsState; refetch: () => void } {
  const organizationId = useOrganizationId();
  const query = useQuery({
    queryKey:
      organizationId !== null
        ? fileQueryKeys.list(organizationId, OVERLAY_ITEMS_PARAMS)
        : fileQueryKeys.unscoped(),
    queryFn: ({ signal }) =>
      fetchJson('/api/library/items', {
        signal,
      }).then((body) => libraryItemsSchema.parse(body)),
    enabled: organizationId !== null,
  });

  React.useEffect(() => {
    if (query.isError)
      captureException(query.error, { feature: 'files', op: 'overlay-library-items' });
  }, [query.isError, query.error]);

  const state: ItemsState = query.isError
    ? { kind: 'error' }
    : query.data === undefined
      ? { kind: 'loading' }
      : { kind: 'ready', files: query.data.files, artifacts: query.data.artifacts };

  return { state, refetch: () => void query.refetch() };
}

// The hash id names either a drive file or an agent artifact; both live in the
// same read, so one lookup serves the Library, the chat's attachments and the
// generated-media previews alike.
/** Download is the preview's only item action, a frame-bar button beside
    Expand and Close: no More menu and no second toolbar in a preview. Save
    to Library and Delete live in the Library item menu. */
function downloadTarget(item: PreviewableItem): { href: string; filename: string } | null {
  if (item.kind === 'artifact' && !item.artifact.downloadable) return null;
  return item.kind === 'file'
    ? { href: downloadUrl(item.file.url), filename: item.file.filename }
    : {
        href: artifactContentUrl(item.artifact.id, { download: true }),
        filename: item.artifact.filename,
      };
}

function findItem(
  state: Extract<ItemsState, { kind: 'ready' }>,
  id: string | null,
): PreviewableItem | null {
  if (id === null) return null;
  const file = state.files.find((candidate) => candidate.id === id);
  if (file) return { kind: 'file', file };
  const artifact = state.artifacts.find((candidate) => candidate.id === id);
  if (artifact) return { kind: 'artifact', artifact };
  return null;
}

export function FilePreviewOverlay({ id, open, onClose }: OverlayComponentProps) {
  const { state, refetch } = useLibraryItems();
  const item = state.kind === 'ready' ? findItem(state, id) : null;
  const download = item ? downloadTarget(item) : null;

  return (
    <PreviewSurface
      kind="file-preview"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={
        item
          ? displayFilename(itemName(item))
          : state.kind === 'loading'
            ? 'Loading preview…'
            : 'Preview'
      }
      headerActions={download ? <PreviewDownloadButton {...download} /> : undefined}
    >
      {state.kind === 'loading' ? (
        <div
          className="flex h-full min-h-[200px] items-center justify-center"
          aria-busy="true"
          aria-label="Loading preview"
        >
          <Spinner className="size-5 text-muted-foreground" aria-hidden />
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <PreviewNotice
          borderless
          title="Couldn’t load this preview"
          message="Something went wrong reading the library."
          retry={refetch}
        />
      ) : null}
      {state.kind === 'ready' && item === null ? (
        <PreviewNotice
          borderless
          title="This file isn’t available"
          message="It may have been deleted, or the link may be from another workspace."
        />
      ) : null}
      {/* Keyed by item so a different id remounts the viewer — no state
          (scroll position, fetched text) leaks between files. */}
      {item?.kind === 'file' ? (
        <FilePreview
          key={item.file.id}
          file={item.file}
          siblings={state.kind === 'ready' ? state.files : []}
        />
      ) : null}
      {item?.kind === 'artifact' ? (
        <ArtifactViewer
          key={item.artifact.id}
          artifact={item.artifact}
          siblings={
            state.kind === 'ready'
              ? state.artifacts.filter(
                  (artifact) => artifact.sessionRowId === item.artifact.sessionRowId,
                )
              : []
          }
        />
      ) : null}
    </PreviewSurface>
  );
}
