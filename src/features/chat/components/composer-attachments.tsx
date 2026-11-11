'use client';

import Image from 'next/image';
import { useState } from 'react';
import { IconFolder, IconGrid01, IconRefreshCw02, IconX } from '@/components/icons';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment';
import { Spinner } from '@/components/ui/spinner';
import { FileKindIcon } from '@/features/files/components/file-kind-icon';
import { fileKindLabel } from '@/features/files/lib/file-types';
import type {
  ComposerLibraryFile,
  ComposerLibraryFolder,
  ComposerSkill,
} from '@/features/sessions/types';
import { plural } from '@/lib/format/plural';
import type { PendingAttachment } from '../lib/attachments';

// The composer's pending picks, in one horizontal rail: an image is a
// rounded square of itself, everything else is a wider tile with the coloured
// type glyph, the name, and the plain type word. Every pick carries its own
// remove control in the same place, always visible, so touch reaches it.
//
const IMAGE_TILE_CLS =
  'size-16 min-w-16 max-w-16 shrink-0 overflow-hidden rounded-lg border-0 bg-alpha-6 p-0! focus-within:ring-0 [@media(hover:hover)]:hover:bg-alpha-6!';
const IMAGE_MEDIA_CLS = 'size-16 rounded-lg bg-transparent';
const IMAGE_REMOVE_CLS =
  'relative size-6 rounded-full bg-background/85 text-foreground backdrop-blur-sm after:absolute after:-inset-2.5 after:content-[""] [@media(hover:hover)]:hover:bg-background';

const FILE_TILE_CLS =
  'h-16 w-60 min-w-60 max-w-60 max-md:h-auto max-md:min-h-16 max-md:w-full max-md:min-w-0 max-md:max-w-full flex-nowrap items-center gap-2.5 rounded-lg border-0 bg-alpha-6 text-foreground py-0! pr-1! pl-3! focus-within:ring-0 [@media(hover:hover)]:hover:bg-alpha-6!';
const CONTENT_CLS = 'min-w-0 overflow-hidden';
const TITLE_CLS = 'flex min-w-0 items-baseline max-md:block text-body font-medium text-foreground';
const DESC_CLS = 'mt-0 text-meta';

export function ComposerAttachments({
  attachments,
  onRemove,
  onRetry,
  libraryFiles = [],
  onRemoveLibraryFile,
  libraryFolders = [],
  onRemoveLibraryFolder,
  skills = [],
  onRemoveSkill,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
  libraryFiles?: ComposerLibraryFile[];
  onRemoveLibraryFile?: (id: string) => void;
  libraryFolders?: ComposerLibraryFolder[];
  onRemoveLibraryFolder?: (path: string) => void;
  skills?: ComposerSkill[];
  onRemoveSkill?: (id: string) => void;
}) {
  if (
    attachments.length === 0 &&
    libraryFiles.length === 0 &&
    libraryFolders.length === 0 &&
    skills.length === 0
  ) {
    return null;
  }

  return (
    <AttachmentGroup
      className="w-full max-w-full gap-2 px-3 pt-3 pb-1 max-md:flex-wrap max-md:max-h-[30dvh] max-md:overflow-y-auto max-md:overscroll-contain"
      data-testid="composer-attachments"
      aria-label="Pending attachments"
    >
      {attachments.map((attachment) => (
        <PickCard
          key={attachment.id}
          name={attachment.file.name}
          detail={fileKindLabel(attachment.file.type, attachment.file.name)}
          mimeType={attachment.file.type}
          previewUrl={attachment.previewUrl}
          onRemove={() => onRemove(attachment.id)}
          status={attachment.status === 'local' ? undefined : attachment.status}
          error={attachment.status === 'failed' ? attachment.error : undefined}
          onRetry={onRetry ? () => onRetry(attachment.id) : undefined}
        />
      ))}

      {libraryFiles.map((file) => (
        <PickCard
          key={file.id}
          name={file.name}
          detail={fileKindLabel(file.mimeType, file.name)}
          mimeType={file.mimeType}
          previewUrl={file.mimeType.startsWith('image/') ? file.url : null}
          onRemove={() => onRemoveLibraryFile?.(file.id)}
        />
      ))}

      {libraryFolders.map((folder) => (
        <PickCard
          key={folder.path}
          name={folder.name}
          detail={`Folder · ${plural(folder.itemCount, 'item')}`}
          icon={<IconFolder className="size-6 text-muted-foreground" />}
          onRemove={() => onRemoveLibraryFolder?.(folder.path)}
        />
      ))}

      {skills.map((skill) => (
        <PickCard
          key={skill.id}
          name={skill.name}
          detail="Skill"
          icon={<IconGrid01 className="size-6 text-muted-foreground" />}
          onRemove={() => onRemoveSkill?.(skill.id)}
        />
      ))}
    </AttachmentGroup>
  );
}

function PickCard({
  name,
  detail,
  mimeType,
  previewUrl = null,
  icon,
  status,
  error,
  onRetry,
  onRemove,
}: {
  name: string;
  detail: string;
  mimeType?: string;
  previewUrl?: string | null;
  icon?: React.ReactNode;
  status?: 'uploading' | 'ready' | 'failed';
  error?: string;
  onRetry?: () => void;
  onRemove: () => void;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const showPreview = previewUrl !== null && !previewFailed;

  const state = status === 'failed' ? 'error' : status === 'uploading' ? 'uploading' : 'done';
  const retry =
    status === 'failed' && onRetry ? (
      <AttachmentAction
        type="button"
        size="icon-xs"
        onClick={onRetry}
        aria-label={`Retry ${name}`}
        title={error ?? `Retry ${name}`}
        className="size-6 rounded-full bg-background text-foreground"
      >
        <IconRefreshCw02 className="size-4" />
      </AttachmentAction>
    ) : null;

  if (showPreview) {
    return (
      <Attachment
        state={state}
        className={IMAGE_TILE_CLS}
        title={error ?? name}
        data-pick="image"
        aria-label={status === 'failed' ? `${name}: upload failed. Retry or remove.` : name}
        aria-busy={status === 'uploading'}
      >
        <AttachmentMedia variant="image" className={IMAGE_MEDIA_CLS}>
          <Image
            src={previewUrl}
            alt={name}
            fill
            sizes="64px"
            unoptimized
            onError={() => setPreviewFailed(true)}
            className="object-cover"
          />
        </AttachmentMedia>
        {status === 'uploading' ? (
          <span
            className="absolute inset-0 grid place-items-center bg-overlay"
            role="status"
            aria-label={`Uploading ${name}`}
          >
            <Spinner className="size-4 text-on-media" />
          </span>
        ) : null}
        {retry ? (
          <AttachmentActions className="absolute bottom-1 left-1">{retry}</AttachmentActions>
        ) : null}
        <AttachmentActions className="absolute top-1 right-1">
          <RemoveButton name={name} onRemove={onRemove} className={IMAGE_REMOVE_CLS} />
        </AttachmentActions>
      </Attachment>
    );
  }

  return (
    <Attachment
      state={state}
      className={FILE_TILE_CLS}
      data-pick="file"
      aria-busy={status === 'uploading'}
    >
      {status === 'uploading' ? (
        <Spinner aria-label={`Uploading ${name}`} />
      ) : (
        (icon ?? <FileKindIcon mimeType={mimeType ?? ''} name={name} className="size-6" />)
      )}
      <AttachmentContent className={CONTENT_CLS}>
        <Filename name={name} />
        <AttachmentDescription className={DESC_CLS}>
          {status === 'failed'
            ? 'Upload failed. Retry or remove.'
            : status === 'uploading'
              ? 'Uploading…'
              : detail}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        {retry}
        <RemoveButton
          name={name}
          onRemove={onRemove}
          className="size-11 shrink-0 text-muted-foreground [@media(hover:hover)]:hover:text-foreground"
        />
      </AttachmentActions>
    </Attachment>
  );
}

function RemoveButton({
  name,
  onRemove,
  className,
}: {
  name: string;
  onRemove: () => void;
  className: string;
}) {
  return (
    <AttachmentAction
      type="button"
      size="icon"
      onClick={onRemove}
      aria-label={`Remove ${name}`}
      title={`Remove ${name}`}
      className={className}
    >
      <IconX className="size-4" />
    </AttachmentAction>
  );
}

function Filename({ name }: { name: string }) {
  const { stem, extension } = splitFilename(name);

  return (
    <AttachmentTitle className={TITLE_CLS} title={name}>
      <span className="sr-only">{name}</span>
      <span
        aria-hidden="true"
        className="min-w-0 truncate max-md:whitespace-normal max-md:wrap-anywhere"
      >
        {stem}
      </span>
      {extension !== '' ? (
        <span aria-hidden="true" className="shrink-0">
          {extension}
        </span>
      ) : null}
    </AttachmentTitle>
  );
}

function splitFilename(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: '' };
  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}
