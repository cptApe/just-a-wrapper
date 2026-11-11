'use client';
import { useReducer } from 'react';
import { IconFolder, IconImage01 } from '@/components/icons';
import { imageReducer } from '@/components/ui/lib/image-machine';
import { fileKind } from '@/features/files/lib/file-types';
import type { FileEntry } from '@/features/files/types';
import { openOverlay } from '@/features/overlays';
import type { OptimisticComposerAttachment } from '@/features/sessions/lib/build-composer-message';
import type { AttachedEntry } from '@/features/sessions/lib/strip-attached-files';
import { cn } from '@/lib/utils';
import { useChatLibraryFiles } from '../hooks/use-chat-library-files';
import { type ChatFileAction, primaryAction } from '../lib/file-link';
import { FileCard } from './file-card';

// The files on a sent user message: images first, as one grid, then
// every other file as a card, one per line, then the message bubble below.
// Nothing is hidden behind a "more" step. Each file is a Library file (the
// composer uploaded it there), so the card and the tile open the Library
// panel once the lookup has matched the durable URL to a Library id; until
// then, and for a file the lookup cannot place, they stay plain.

type DisplayEntry = AttachedEntry & {
  id?: string;
  mimeType?: string;
  durableUrl?: string | null;
};

type ImageEntry = Extract<DisplayEntry, { kind: 'file' }> & { url: string };

function isImageEntry(entry: DisplayEntry): entry is ImageEntry {
  return (
    entry.kind === 'file' &&
    entry.url !== null &&
    fileKind(entry.mimeType ?? '', entry.name) === 'image'
  );
}

function entryKey(entry: DisplayEntry): string {
  if (entry.id) return entry.id;
  return entry.kind === 'folder' ? `folder-${entry.path}` : `file-${entry.name}-${entry.url}`;
}

export function MessageAttachments({
  entries: durableEntries,
  attachments = [],
}: {
  entries: AttachedEntry[];
  attachments?: OptimisticComposerAttachment[];
}) {
  // Consume one durable entry per local pick, including duplicate filenames.
  const unmatched = [...durableEntries];
  const entries: DisplayEntry[] = attachments.map((attachment) => {
    const index = unmatched.findIndex(
      (entry) => entry.kind === 'file' && entry.name === attachment.name,
    );
    const durable = index === -1 ? undefined : unmatched.splice(index, 1)[0];
    return {
      kind: 'file',
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      durableUrl: durable?.kind === 'file' ? durable.url : null,
      url: attachment.previewUrl ?? (durable?.kind === 'file' ? durable.url : null),
    };
  });
  entries.push(...unmatched);
  const lookup = useChatLibraryFiles(
    durableEntries.some((entry) => entry.kind === 'file' && entry.url !== null),
    durableEntries.map((entry) => (entry.kind === 'file' ? entry.url : entry.path)).join('\n'),
  );
  const byUrl = new Map((lookup.data ?? []).map((file) => [file.url, file]));

  if (entries.length === 0) return null;

  const fileFor = (entry: DisplayEntry): FileEntry | undefined =>
    entry.kind === 'file' && entry.url && lookup.isSuccess
      ? byUrl.get(entry.durableUrl ?? entry.url)
      : undefined;
  const actionFor = (entry: DisplayEntry): ChatFileAction | null => {
    const file = fileFor(entry);
    return file ? primaryAction({ kind: 'library', file }) : null;
  };

  const images = entries.filter(isImageEntry);
  const files = entries.filter((entry) => !isImageEntry(entry));

  function mimeTypeFor(entry: DisplayEntry): string {
    if (entry.mimeType !== undefined) return entry.mimeType;
    return fileFor(entry)?.mimeType ?? '';
  }

  return (
    <div
      className="flex w-full max-w-[32rem] flex-col items-end gap-1.5"
      data-testid="message-attachments"
    >
      {images.length > 0 ? (
        <ImageGrid
          images={images.map((entry) => ({
            entry,
            action: actionFor(entry),
            mimeType: mimeTypeFor(entry),
          }))}
        />
      ) : null}
      {files.map((entry) =>
        entry.kind === 'folder' ? (
          <FileCard
            key={entryKey(entry)}
            name={entry.name}
            mimeType=""
            detail="Folder"
            icon={<IconFolder aria-hidden className="size-6 text-muted-foreground" />}
            action={null}
            testId="message-attachment"
          />
        ) : (
          <FileCard
            key={entryKey(entry)}
            name={entry.name}
            mimeType={mimeTypeFor(entry)}
            action={actionFor(entry)}
            testId="message-attachment"
          />
        ),
      )}
    </div>
  );
}

type ImageItem = {
  entry: ImageEntry;
  action: ChatFileAction | null;
  mimeType: string;
};

// A deterministic grid: one image keeps its own shape inside a bounded box,
// two share the row as equal squares, three or more fill up to three columns
// of squares with one compact gap. Nothing is inferred from image sizes, so
// the layout is the same before and after the bytes arrive.
function ImageGrid({ images }: { images: ImageItem[] }) {
  const only = images.at(0);
  if (images.length === 1 && only) {
    return (
      <div className="flex w-full justify-end" data-testid="attachment-images" data-count="1">
        <AttachmentImage item={only} shape="natural" />
      </div>
    );
  }
  return (
    <div
      className={cn(
        'grid w-full max-w-[26rem] gap-1.5',
        images.length === 2 ? 'grid-cols-2' : 'grid-cols-3',
      )}
      data-testid="attachment-images"
      data-count={images.length}
    >
      {images.map((item) => (
        <AttachmentImage key={entryKey(item.entry)} item={item} shape="square" />
      ))}
    </div>
  );
}

/**
 * @public The image transition test renders it directly. Load state is keyed to the current src,
 * so a replaced URL never inherits the previous image's ready or broken state.
 */
export function AttachmentImage({ item, shape }: { item: ImageItem; shape: 'natural' | 'square' }) {
  const { entry, action } = item;
  const [loaded, dispatchImage] = useReducer(imageReducer, { kind: 'loading', src: entry.url });
  if (loaded.src !== entry.url) dispatchImage({ type: 'source', src: entry.url });
  const state = loaded.src === entry.url ? loaded.kind : 'loading';
  const frame = cn(
    'relative overflow-hidden rounded-xl bg-alpha-6',
    shape === 'square'
      ? 'aspect-square w-full'
      : state === 'ready'
        ? 'inline-flex max-w-full'
        : 'aspect-[4/3] w-60 max-w-full',
    action && state !== 'error'
      ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      : '',
  );
  const content =
    state === 'error' ? (
      <span
        className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center text-meta font-medium text-muted-foreground"
        data-testid="attachment-image-error"
      >
        <IconImage01 aria-hidden className="size-5" />
        <span className="line-clamp-2 wrap-anywhere">{entry.name}</span>
      </span>
    ) : (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- attachment images use durable CDN URLs */}
        <img
          key={entry.url}
          src={entry.url}
          alt={entry.name}
          className={cn(
            shape === 'square'
              ? 'absolute inset-0 size-full object-cover'
              : state === 'ready'
                ? 'block max-h-80 max-w-full object-contain'
                : 'absolute inset-0 size-full object-cover',
            state === 'loading' && 'opacity-0',
          )}
          ref={(element) => {
            if (state === 'loading' && element?.complete && element.naturalWidth > 0) {
              dispatchImage({ type: 'ready', src: entry.url });
            }
          }}
          onLoad={() => dispatchImage({ type: 'ready', src: entry.url })}
          onError={() => dispatchImage({ type: 'error', src: entry.url })}
          data-testid="attachment-image-content"
        />
        {state === 'loading' ? (
          <span
            aria-hidden
            className={cn(
              'absolute inset-0 bg-[length:200%_100%]',
              'bg-[linear-gradient(115deg,transparent_35%,var(--color-alpha-8)_50%,transparent_65%)]',
              'animate-[tw-shimmer_1.8s_ease-in-out_infinite] motion-reduce:animate-none',
            )}
          />
        ) : null}
      </>
    );

  // Keep the image mounted when the Library lookup enables its action.
  // Replacing a span with a button would restart its loading state.
  return (
    <span
      className={frame}
      title={entry.name}
      data-testid="attachment-image"
      data-file-action={state !== 'error' ? action?.kind : undefined}
    >
      {content}
      {action?.kind === 'open' && state !== 'error' ? (
        <button
          type="button"
          onClick={() => openOverlay(action.hash)}
          className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`Open ${entry.name}`}
        />
      ) : action?.kind === 'download' && state !== 'error' ? (
        <a
          href={action.href}
          download={action.filename}
          className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`Download ${entry.name}`}
        />
      ) : null}
    </span>
  );
}
