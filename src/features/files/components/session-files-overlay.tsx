'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { IconFileQuestion01 } from '@/components/icons';
import { useOrganizationId } from '@/components/providers/app-providers';
import { Button } from '@/components/ui/button';
import { ListRow, ListRowIcon, ListRowTitle } from '@/components/ui/list-row';
import { PreviewDownloadButton, PreviewSurface } from '@/components/ui/preview-surface';
import { Spinner } from '@/components/ui/spinner';
// Leaf import past the overlays barrel on purpose: the barrel exports the host,
// whose registry imports this file — the pure hash builder has no such loop.
import { buildOverlayHash } from '@/features/overlays/lib/hash';
// Type-only import — erased at compile time, no runtime edge back to the host.
import type { OverlayComponentProps } from '@/features/overlays/types';
import { fetchJson } from '@/lib/fetch-json';
import { type SessionFilesResponse, sessionFilesSchema } from '@/lib/file-response-schema';
import { captureException } from '@/lib/observability-client';
import { artifactQueryKeys } from '../api/keys';
import { artifactContentUrl } from '../lib/content-url';
import { fileKind } from '../lib/file-types';
import type { ArtifactSummary, SessionFile, SessionLibraryFile } from '../types';
import { ArtifactViewer } from './artifact-viewer';
import { FileKindIcon } from './file-kind-icon';
import { SaveToKnowledgeButton } from './save-to-knowledge-button';

// The task-files hash loads either a narrow file list or one item preview.
// Selecting from the list replaces the hash so Back and Close return to the task.
// Load data from hash parameters for cold links and share the session query.
// Single-item previews have their own actions without sibling navigation.

/** The id segment that asks for the list instead of one file. */
const SESSION_FILES_LIST_ID = 'all';

type ArtifactsState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; artifacts: ArtifactSummary[]; libraryFiles: SessionLibraryFile[] };

// The task's artifact list, on the query cache under the same
// session key prefix the chat surface invalidates. Its own suffix keeps the
// combined response separate from the transcript’s artifact-only projection.
function useSessionArtifactList(sessionId: string | null): {
  state: ArtifactsState;
  refetch: () => void;
} {
  const organizationId = useOrganizationId();
  const enabled = sessionId !== null && organizationId !== null;
  const query = useQuery({
    queryKey: enabled
      ? [...artifactQueryKeys.session(organizationId, sessionId), 'files-panel']
      : artifactQueryKeys.unscoped(),
    queryFn: ({ signal }) =>
      fetchJson(`/api/sessions/${sessionId}/artifacts`, {
        signal,
      }).then((body) => sessionFilesSchema.parse(body)),
    enabled,
    // Uploads can be attached while the panel is closed. Reopening must read them.
    staleTime: 0,
  });

  React.useEffect(() => {
    if (query.isError)
      captureException(query.error, { feature: 'artifacts', op: 'overlay-session-files' });
  }, [query.isError, query.error]);

  const state: ArtifactsState = query.isError
    ? { kind: 'error' }
    : query.data === undefined
      ? { kind: 'loading' }
      : { kind: 'ready', ...query.data };

  return { state, refetch: () => void query.refetch() };
}

export function SessionFilesOverlay({
  id,
  params,
  open,
  onClose,
  onReplaceHash,
}: OverlayComponentProps) {
  const sessionId = params.get('session');
  const { state, refetch } = useSessionArtifactList(sessionId);
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId();
  const artifacts = state.kind === 'ready' ? state.artifacts : [];
  function markSaved(artifactId: string, savedDriveFileId: string) {
    if (organizationId === null || sessionId === null) return;
    queryClient.setQueryData<SessionFilesResponse>(
      [...artifactQueryKeys.session(organizationId, sessionId), 'files-panel'],
      (current) =>
        current
          ? {
              ...current,
              artifacts: current.artifacts.map((artifact) =>
                artifact.id === artifactId ? { ...artifact, savedDriveFileId } : artifact,
              ),
            }
          : current,
    );
  }

  const files = mergeSessionFiles(artifacts, state.kind === 'ready' ? state.libraryFiles : []);

  const listMode = id === SESSION_FILES_LIST_ID || id === null;

  function onOpenChange(next: boolean) {
    if (!next) onClose();
  }

  function showFile(file: SessionFile) {
    if (!sessionId) return;
    onReplaceHash(
      file.kind === 'library'
        ? buildOverlayHash('file', file.id)
        : buildOverlayHash('task-file', file.id, { session: sessionId }),
    );
  }

  if (listMode) {
    return (
      // Keyed by shape so list → file swaps frames (a fresh canvas slides in)
      // instead of morphing one dialog into the other.
      <PreviewSurface
        key="list"
        kind="session-files"
        frame="list"
        open={open}
        onOpenChange={onOpenChange}
        title="Files in this task"
      >
        {!sessionId ? (
          <OverlayNotice
            title="This link is incomplete"
            message="It doesn’t say which task’s files to show."
          />
        ) : state.kind === 'loading' ? (
          <LoadingState label="Loading files" />
        ) : state.kind === 'error' ? (
          <OverlayNotice
            title="Couldn’t load this task’s files"
            message="Something went wrong reading the file list."
            retry={refetch}
          />
        ) : files.length === 0 ? (
          <OverlayNotice
            title="No files yet"
            message="Uploads and files the agent makes in this task will show up here."
          />
        ) : (
          <SessionFileList files={files} onSelect={showFile} />
        )}
      </PreviewSurface>
    );
  }

  const item = artifacts.find((a) => a.id === id) ?? null;

  return (
    <PreviewSurface
      key="file"
      kind="session-files"
      open={open}
      onOpenChange={onOpenChange}
      title={item ? item.filename : state.kind === 'loading' ? 'Loading file…' : 'Task file'}
      headerActions={
        item?.downloadable ? (
          <PreviewDownloadButton
            href={artifactContentUrl(item.id, { download: true })}
            filename={item.filename}
          />
        ) : undefined
      }
      actions={
        item?.downloadable ? (
          <SaveToKnowledgeButton
            artifact={item}
            className="min-h-11 sm:min-h-9"
            onSaved={markSaved}
          />
        ) : undefined
      }
    >
      {!sessionId ? (
        <OverlayNotice
          title="This link is incomplete"
          message="It doesn’t say which task’s files to show."
        />
      ) : state.kind === 'loading' ? (
        <LoadingState label="Loading file" />
      ) : state.kind === 'error' ? (
        <OverlayNotice
          title="Couldn’t load this file"
          message="Something went wrong reading the task’s files."
          retry={refetch}
        />
      ) : item === null ? (
        <OverlayNotice
          title="This file isn’t available"
          message="It may have been deleted, or the link may be from another task."
        />
      ) : (
        // Keyed by item so a different file remounts the viewer — no state
        // leaks between files.
        <ArtifactViewer key={item.id} artifact={item} siblings={artifacts} />
      )}
    </PreviewSurface>
  );
}

/** Both inputs are scoped to the same authorized session by the route. */
function mergeSessionFiles(
  artifacts: readonly ArtifactSummary[],
  libraryFiles: readonly SessionLibraryFile[],
): SessionFile[] {
  const libraryIds = new Set(libraryFiles.map((file) => file.id));
  const uploadMatches = new Set(
    libraryFiles.map((file) => JSON.stringify([file.filename, file.sizeBytes])),
  );
  return [
    ...libraryFiles.map((file): SessionFile => ({ ...file, kind: 'library' })),
    ...artifacts
      .filter((artifact) => {
        if (artifact.savedDriveFileId && libraryIds.has(artifact.savedDriveFileId)) return false;
        return !(
          !artifact.downloadable &&
          uploadMatches.has(JSON.stringify([artifact.filename, artifact.sizeBytes]))
        );
      })
      .map((artifact): SessionFile => ({ ...artifact, kind: 'artifact' })),
  ].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

// One narrow column of names. Each row opens that file's preview in place.
function SessionFileList({
  files,
  onSelect,
}: {
  files: readonly SessionFile[];
  onSelect: (file: SessionFile) => void;
}) {
  return (
    <ul className="flex flex-col gap-1" aria-label="Files in this task">
      {files.map((file) => (
        <li key={`${file.kind}/${file.id}`}>
          <ListRow asChild className="min-h-10 touch-manipulation gap-2 px-1 py-0.5">
            <button type="button" onClick={() => onSelect(file)} title={file.filename}>
              <FileListThumb file={file} />
              <ListRowTitle>{file.filename}</ListRowTitle>
            </button>
          </ListRow>
        </li>
      ))}
    </ul>
  );
}

/** The row's 32 px square: the picture itself for images so two uploads never
 * look alike, the kind glyph for everything else, and the glyph again if the
 * picture fails to load. */
function FileListThumb({ file }: { file: SessionFile }) {
  const kind = fileKind(file.mimeType, file.filename);
  const [broken, setBroken] = React.useState(false);
  const src =
    kind === 'image' && !broken
      ? file.kind === 'library'
        ? file.url
        : artifactContentUrl(file.id)
      : null;
  if (src) {
    return (
      <span
        className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-alpha-6"
        aria-hidden
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated artifact bytes and durable CDN uploads cannot use the image optimizer */}
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
      </span>
    );
  }
  return (
    <ListRowIcon className="size-8">
      <FileKindIcon mimeType={file.mimeType} name={file.filename} className="size-4" />
    </ListRowIcon>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div
      className="flex h-full min-h-[200px] items-center justify-center"
      aria-busy="true"
      aria-label={label}
    >
      <Spinner className="size-5 text-muted-foreground" aria-hidden />
    </div>
  );
}

function OverlayNotice({
  title,
  message,
  retry,
}: {
  title: string;
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-muted-foreground">
        <IconFileQuestion01 className="size-5" />
      </div>
      <p className="text-title-card font-semibold">{title}</p>
      <p className="max-w-sm text-meta text-muted-foreground">{message}</p>
      {retry ? (
        // min-h-11: the one action in an error state gets the same 44px
        // target as the frame's other controls.
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-1 min-h-11"
          onClick={retry}
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}
