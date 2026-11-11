'use client';

import { useState } from 'react';
import { IconChevronDown, IconChevronUp, IconDownload01 } from '@/components/icons';
import { FileKindIcon } from '@/features/files/components/file-kind-icon';
import { fileKindLabel } from '@/features/files/lib/file-types';
import { openOverlay } from '@/features/overlays';
import { cn } from '@/lib/utils';
import {
  type ChatFileTarget,
  type DownloadFileAction,
  downloadAction,
  type OpenFileAction,
  openAction,
  targetPreviewable,
} from '../lib/file-link';
import type { TurnFile } from '../lib/turn-files';
import { ExtensionPreservingName } from './extension-preserving-name';

// Show reply files in one list, initially three, with an expand control.
// Rows reveal their action without moving text; touch keeps download visible.
// Unsupported previews remain download links; missing files show an explanation.
// Save to Library belongs in the preview panel.

const COLLAPSED_COUNT = 3;

type FileRow = {
  key: string;
  name: string;
  mimeType: string;
  open: OpenFileAction | null;
  download: DownloadFileAction | null;
  previewable: boolean;
};

function artifactRow(key: string, target: ChatFileTarget & { kind: 'artifact' }): FileRow {
  const open = openAction(target);
  const download = downloadAction(target);
  return {
    key,
    name: target.artifact.filename,
    mimeType: target.artifact.mimeType,
    open,
    download,
    previewable: targetPreviewable(target),
  };
}

function toRow(file: TurnFile, sessionId: string): FileRow {
  if (file.kind === 'artifact') {
    return artifactRow(file.key, {
      kind: 'artifact',
      artifact: file.artifact,
      sessionId,
    });
  }
  if (file.artifact) {
    return artifactRow(file.key, {
      kind: 'artifact',
      artifact: file.artifact,
      sessionId,
    });
  }
  const isImage = file.ref.blockType === 'image';
  return {
    key: file.key,
    name: file.ref.title ?? (isImage ? 'Image' : 'File'),
    mimeType: isImage ? 'image/unknown' : '',
    open: null,
    download: null,
    previewable: false,
  };
}

export function TurnFiles({ sessionId, files }: { sessionId: string; files: TurnFile[] }) {
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;
  const rows = files.map((file) => toRow(file, sessionId));
  const previewableRows = rows.filter((row) => row.previewable);
  const otherRows = rows.filter((row) => !row.previewable);
  const hiddenCount = previewableRows.length - COLLAPSED_COUNT;
  const visible =
    expanded || hiddenCount <= 0 ? previewableRows : previewableRows.slice(0, COLLAPSED_COUNT);
  return (
    <section
      aria-label="Files from this reply"
      className="flex flex-col gap-2 pt-1"
      data-testid="turn-files"
    >
      {previewableRows.length > 0 ? (
        <ul className="max-w-[32rem] divide-y divide-border overflow-hidden rounded-xl border border-border">
          {visible.map((row) => (
            <FileRowItem key={row.key} row={row} />
          ))}
          {hiddenCount > 0 ? (
            <li>
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-body text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [@media(hover:hover)]:hover:bg-alpha-6"
                data-testid="turn-files-toggle"
              >
                {expanded ? (
                  <IconChevronUp aria-hidden className="size-4 text-muted-foreground" />
                ) : (
                  <IconChevronDown aria-hidden className="size-4 text-muted-foreground" />
                )}
                {expanded ? 'Show less' : `${hiddenCount} more`}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {otherRows.length > 0 ? (
        <ul aria-label="Other files" className="flex flex-col items-start gap-1 px-1 text-meta">
          {otherRows.map((row) => (
            <UnsupportedFileReference key={row.key} row={row} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function UnsupportedFileReference({ row }: { row: FileRow }) {
  return (
    <li data-testid="turn-file-reference">
      {row.download ? (
        <a
          href={row.download.href}
          download={row.download.filename}
          className="rounded-sm font-medium text-foreground underline decoration-border underline-offset-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Download ${row.name}`}
          data-file-action="download"
        >
          Download {row.name}
        </a>
      ) : (
        <span className="text-muted-foreground">{row.name} is unavailable</span>
      )}
    </li>
  );
}

const ROW_CLASS = 'flex min-h-[60px] min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left';
const ROW_FOCUS_CLASS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset';

function FileRowItem({ row }: { row: FileRow }) {
  const { open, download } = row;
  const hoverLabel = open ? 'Open file' : download ? 'Download' : null;
  const body = (
    <>
      <FileKindIcon mimeType={row.mimeType} name={row.name} className="size-6" />
      <span className="flex min-w-0 flex-1 flex-col">
        <ExtensionPreservingName
          name={row.name}
          className="text-body font-medium text-foreground"
        />
        {/* Both captions share one grid cell, so the swap never moves the name. */}
        <span className="grid text-meta text-muted-foreground">
          <span
            className={cn(
              'col-start-1 row-start-1 truncate transition-opacity duration-150',
              hoverLabel &&
                'group-focus-within/file:opacity-0 [@media(hover:hover)]:group-hover/file:opacity-0',
            )}
          >
            {fileKindLabel(row.mimeType, row.name)}
          </span>
          {hoverLabel ? (
            <span
              aria-hidden
              className="col-start-1 row-start-1 truncate opacity-0 transition-opacity duration-150 group-focus-within/file:opacity-100 [@media(hover:hover)]:group-hover/file:opacity-100"
            >
              {hoverLabel}
            </span>
          ) : null}
        </span>
      </span>
    </>
  );

  return (
    <li
      className="group/file flex items-stretch transition-colors duration-150 focus-within:bg-alpha-6 [@media(hover:hover)]:hover:bg-alpha-6"
      data-testid="turn-file"
    >
      {open ? (
        <button
          type="button"
          onClick={() => openOverlay(open.hash)}
          aria-label={`Open ${row.name}`}
          className={cn(ROW_CLASS, ROW_FOCUS_CLASS)}
          data-file-action="open"
        >
          {body}
        </button>
      ) : download ? (
        <a
          href={download.href}
          download={download.filename}
          aria-label={`Download ${row.name}`}
          className={cn(ROW_CLASS, ROW_FOCUS_CLASS)}
          data-file-action="download"
        >
          {body}
        </a>
      ) : (
        <div className={ROW_CLASS}>{body}</div>
      )}
      {open && download ? (
        <a
          href={download.href}
          download={download.filename}
          aria-label={`Download ${row.name}`}
          className="my-auto mr-2 flex size-11 shrink-0 items-center justify-center rounded-button text-foreground opacity-0 transition-opacity duration-150 group-hover/file:opacity-100 group-focus-within/file:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:bg-alpha-8"
          data-testid="turn-file-download"
        >
          <IconDownload01 aria-hidden className="size-5" />
        </a>
      ) : null}
    </li>
  );
}
