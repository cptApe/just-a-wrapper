'use client';
import Link from 'next/link';

import { IconInfoCircle } from '@/components/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { isSafeInternalHref } from '@/lib/safe-internal-href';
import { cn } from '@/lib/utils';
import { libraryHref } from '../../lib/library-href';
import {
  MEDIA_SAVED_TO_LIBRARY,
  type MediaKind,
  type MediaMetaRow,
  mediaDetailsLabel,
  mediaPopoverTitle,
} from '../../lib/tool-display-details';

// The corner ⓘ affordance + details popover for a settled generated-media card.
// The media itself renders frameless (no card shell), so this is the one place
// the generation prompt, the model/size (or
// duration/aspect) meta, and the Library location live. Hover-capable devices
// reveal the chip on hover or keyboard focus; touch devices (no hover) keep it
// always visible. Every string comes from lib/tool-display.ts.

export function MediaDetailsPopover({
  kind,
  prompt,
  metaRows,
  folderPath,
}: {
  kind: MediaKind;
  prompt?: string;
  metaRows: MediaMetaRow[];
  folderPath?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={mediaDetailsLabel(kind)}
          data-testid="media-details-trigger"
          className={cn(
            // 44px hit area (size-11); the visible chip is centered inside it.
            'absolute right-1 top-1 flex size-11 items-center justify-center',
            'opacity-100 transition-opacity duration-150',
            // Hover-capable devices hide the chip until hover or keyboard focus;
            // touch devices (no hover) fall through to the always-visible base.
            '[@media(hover:hover)]:opacity-0',
            '[@media(hover:hover)]:group-hover:opacity-100',
            '[@media(hover:hover)]:focus-visible:opacity-100',
          )}
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-scrim text-on-media backdrop-blur-sm">
            <IconInfoCircle className="size-4" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={mediaPopoverTitle(kind)}
        data-testid="media-details-popover"
      >
        <div className="flex flex-col gap-3">
          {prompt ? <p className="whitespace-pre-wrap break-words text-body">{prompt}</p> : null}

          {metaRows.length > 0 ? (
            <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-4 gap-y-1.5">
              {metaRows.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-meta font-medium text-muted-foreground">{row.label}</dt>
                  <dd className="min-w-0 truncate text-meta font-medium" title={row.value}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {folderPath ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-meta font-medium text-muted-foreground">
                {MEDIA_SAVED_TO_LIBRARY}
              </span>
              {isSafeInternalHref(folderPath) ? (
                <Link
                  href={libraryHref(folderPath)}
                  className="truncate text-meta font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
                  data-testid="media-library-link"
                >
                  {folderPath}
                </Link>
              ) : (
                <span className="truncate text-meta font-medium text-foreground">{folderPath}</span>
              )}
            </div>
          ) : (
            <span className="text-meta font-medium text-muted-foreground">
              {MEDIA_SAVED_TO_LIBRARY}
            </span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
