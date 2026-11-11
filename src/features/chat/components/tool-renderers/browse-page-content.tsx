'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { IconLinkExternal01, IconPlayCircleSolid, IconXClose } from '@/components/icons';
import { CodeBlock } from '@/components/ui/code-block';
import { BrowserReplaySurface } from '@/features/tools/components/browser-replay-surface';
import { REPLAY_BACK_LABEL, REPLAY_WATCH_LABEL } from '../../lib/tool-display';
import { type PageScreenshot, readBrowsedPage } from '../../lib/tool-result-data';
import { DefaultDetails } from './default-outcome';
import type { ToolRendererProps } from './tool-renderer-types';

// Always-visible preview for `browse_page`: one replay card whose caption is
// the linked page title. When the browse recorded a Browserbase session, the
// snapshot gains a "Watch replay" affordance that swaps the still for an inline
// HLS player. Extracted page text stays behind the activity-line disclosure.

export function BrowsePagePreview({ item }: ToolRendererProps) {
  if (!item.result || item.result.isError) return null;
  const page = readBrowsedPage(item.result.text);
  if (!page) return null;

  return (
    <div
      className="w-fit max-w-full overflow-hidden rounded-xl border border-border"
      data-testid="browsed-page-preview"
    >
      {page.screenshot ? (
        <BrowseSnapshot
          screenshot={page.screenshot}
          title={page.title}
          browserbaseSessionId={page.browserbaseSessionId}
        />
      ) : null}
      <a
        href={page.url}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 items-center gap-1.5 px-3 py-2 text-meta font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
      >
        <span className="truncate">{page.title}</span>
        <IconLinkExternal01 className="size-3.5 shrink-0 text-muted-foreground" />
      </a>
    </div>
  );
}

// The snapshot with its optional replay affordance. The still <img> always
// renders and reserves the box (its captured dims are the aspect ratio, so no
// CLS); the play button and, once watching, the player overlay it absolutely so
// the layout never shifts between states.
function BrowseSnapshot({
  screenshot,
  title,
  browserbaseSessionId,
}: {
  screenshot: PageScreenshot;
  title: string;
  browserbaseSessionId?: string;
}) {
  // OUR session.id uuid from the task route — the key half of the replay proxy's
  // ownership gate. Absent outside a task route (e.g. the dev board), where the
  // affordance still shows but the player degrades to "not available".
  const params = useParams<{ id?: string }>();
  const sessionId = params.id;
  const [watching, setWatching] = useState(false);
  const canReplay = Boolean(browserbaseSessionId);

  return (
    <div
      className="relative max-w-full overflow-hidden"
      style={{ aspectRatio: `${screenshot.width} / ${screenshot.height}` }}
    >
      {/* Plain <img>, not next/image: the source is a durable-store URL (or a dev
          data URI) that doesn't go through the optimizer proxy. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- direct durable-store previews avoid an unnecessary proxy hop */}
      <img
        src={screenshot.url}
        alt={`Snapshot of ${title}`}
        className="max-h-64 w-auto max-w-full"
        style={{ aspectRatio: `${screenshot.width} / ${screenshot.height}` }}
        data-testid="browsed-page-screenshot"
      />
      {watching && browserbaseSessionId ? (
        <>
          <BrowserReplaySurface sessionId={sessionId} browserbaseSessionId={browserbaseSessionId} />
          <button
            type="button"
            onClick={() => setWatching(false)}
            aria-label={REPLAY_BACK_LABEL}
            className="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-full bg-background/80 text-foreground backdrop-blur-sm transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconXClose className="size-4" />
          </button>
        </>
      ) : canReplay ? (
        <button
          type="button"
          onClick={() => setWatching(true)}
          aria-label={REPLAY_WATCH_LABEL}
          className="group absolute inset-0 flex items-center justify-center bg-transparent transition hover:bg-scrim/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          data-testid="browsed-page-replay-play"
        >
          <span className="flex items-center gap-1.5 rounded-button bg-background/85 px-3 py-1.5 text-meta font-medium text-foreground shadow-sm backdrop-blur-sm transition group-hover:bg-background">
            <IconPlayCircleSolid className="size-4 text-primary" />
            {REPLAY_WATCH_LABEL}
          </span>
        </button>
      ) : null}
    </div>
  );
}

// Unfolded detail for `browse_page`: plain, copyable extracted text using the
// shared details layout. The title lives in the preview caption and is not
// repeated here. Errors and off-contract results fall back to the default.

export function BrowsePageContent({ item }: ToolRendererProps) {
  if (!item.result) return null;
  const page = item.result.isError ? null : readBrowsedPage(item.result.text);
  if (!page) return <DefaultDetails item={item} />;

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="browsed-page">
      <CodeBlock
        code={page.text || 'This page had no readable text'}
        label="Output"
        maxHeightClassName="max-h-64"
      />
      {page.truncated ? (
        <p className="text-meta font-medium text-muted-foreground">
          Page text was long and has been shortened.
        </p>
      ) : null}
    </div>
  );
}
