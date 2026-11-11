'use client';

import type { ReactNode } from 'react';
import { FileKindIcon } from '@/features/files/components/file-kind-icon';
import { fileKindLabel } from '@/features/files/lib/file-types';
import { openOverlay } from '@/features/overlays';
import { cn } from '@/lib/utils';
import type { ChatFileAction } from '../lib/file-link';
import { ExtensionPreservingName } from './extension-preserving-name';

// Non-image file cards show glyph, name and type. Actionable cards preview or download;
// missing targets remain plain. Cap size at 320 by 60 while allowing column shrink.

const FILE_CARD_CLASS =
  'flex min-h-[60px] w-full max-w-80 items-center gap-3 rounded-xl border border-border px-3 py-2 text-left';

const INTERACTIVE_CLASS =
  'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:bg-alpha-6';

export function FileCard({
  name,
  mimeType,
  action,
  detail,
  icon,
  className,
  testId,
}: {
  name: string;
  mimeType: string;
  /** Open the panel, download, or null for a card with nothing to do. */
  action: ChatFileAction | null;
  /** The second line; the plain type word unless the caller knows better. */
  detail?: string;
  /** Replaces the type glyph (a folder, for instance). */
  icon?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const body = (
    <>
      {icon ?? <FileKindIcon mimeType={mimeType} name={name} className="size-6" />}
      <span className="flex min-w-0 flex-1 flex-col">
        <ExtensionPreservingName name={name} className="text-body font-medium text-foreground" />
        <span className="truncate max-md:whitespace-normal max-md:wrap-anywhere text-meta text-muted-foreground">
          {detail ?? fileKindLabel(mimeType, name)}
        </span>
      </span>
    </>
  );

  if (action?.kind === 'open') {
    return (
      <button
        type="button"
        onClick={() => openOverlay(action.hash)}
        aria-label={`Open ${name}`}
        className={cn(FILE_CARD_CLASS, INTERACTIVE_CLASS, className)}
        data-testid={testId}
        data-file-action="open"
      >
        {body}
      </button>
    );
  }
  if (action?.kind === 'download') {
    return (
      <a
        href={action.href}
        download={action.filename}
        aria-label={`Download ${name}`}
        className={cn(FILE_CARD_CLASS, INTERACTIVE_CLASS, className)}
        data-testid={testId}
        data-file-action="download"
      >
        {body}
      </a>
    );
  }
  return (
    <div className={cn(FILE_CARD_CLASS, className)} data-testid={testId}>
      {body}
    </div>
  );
}
