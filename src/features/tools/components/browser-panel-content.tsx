import type { ReactNode, RefObject } from 'react';
import { IconBrowser, IconRefreshCw02 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { type BrowserPanelState, displayAddress, liveViewSrc } from '../lib/browser-panel-state';
import { BrowserReplaySurface } from './browser-replay-surface';

const LIVE_VIEW_SANDBOX = 'allow-same-origin allow-scripts';
const LIVE_VIEW_ALLOW = 'clipboard-read; clipboard-write';

const FIXTURE_PAGE =
  '<!doctype html><html><body style="margin:0;font:14px system-ui"><header style="padding:14px 20px;border-bottom:1px solid"><b>Example Store</b></header><main style="padding:28px"><h1 style="font-size:24px">Orders</h1><p>Three orders are ready to review.</p><button style="margin-top:16px;padding:9px 14px">Open latest order</button></main></body></html>';

export function PanelMeta({ state }: { state: BrowserPanelState }) {
  if (state.kind === 'loading') return <>Opening the live browser…</>;
  if (state.kind === 'error') return <>Live view not available</>;
  const address = displayAddress(state.url);
  const driving = state.kind === 'live' && state.browserStatus === 'user';
  const dotClass =
    state.kind === 'live' ? (driving ? 'bg-primary' : 'bg-success') : 'bg-muted-foreground/50';
  const label = state.kind === 'live' ? (driving ? 'You’re driving' : 'Live') : 'Ended';
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', dotClass)} />
      <span className="shrink-0">{label}</span>
      {address ? (
        <>
          <span aria-hidden className="shrink-0">
            ·
          </span>
          <span className="min-w-0 truncate" title={state.url ?? undefined}>
            {address}
          </span>
        </>
      ) : null}
    </span>
  );
}

// The remote browser is 1280×800, so the view is a 16:10 frame that fits the
// panel on whichever axis is tighter (width in the side canvas, height in the
// modal frame) and is centered on the other — scaled, never stretched, never
// letterboxed inside a taller box. The container query gives the frame the
// panel's real height without a fixed pixel budget.
function ViewportFrame({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center [container-type:size]">
      <div
        className={cn(
          'relative aspect-[16/10] w-[min(100%,160cqh)] overflow-hidden rounded-xl border border-border bg-alpha-3',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

// Who owns the mouse right now, pinned inside the frame (the Browserbase
// reference embed uses the same corner chip). Visual only: the header's
// description line already announces the same state change.
function ControlChip({ driving }: { driving: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute bottom-3 left-3 z-10 rounded-full px-2.5 py-1 text-meta font-medium shadow-sm backdrop-blur-sm',
        driving ? 'bg-primary text-primary-foreground' : 'bg-background/85 text-muted-foreground',
      )}
    >
      {driving ? 'You’re driving · the agent waits' : 'View only'}
    </div>
  );
}

export function BrowserPanelBody({
  sessionId,
  state,
  iframeRef,
  fixture,
  onRetry,
}: {
  sessionId: string | null;
  state: BrowserPanelState;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  fixture: boolean;
  onRetry: () => void;
}) {
  if (state.kind === 'loading') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ViewportFrame>
          <div aria-hidden className="absolute inset-0 animate-pulse bg-alpha-6" />
          <div
            className="absolute inset-0 flex items-center justify-center gap-2 text-meta font-medium text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Spinner className="size-4" />
            Opening the live browser…
          </div>
        </ViewportFrame>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ViewportFrame>
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
            role="alert"
          >
            <span
              aria-hidden
              className="inline-flex size-10 items-center justify-center rounded-full bg-alpha-8 text-muted-foreground"
            >
              <IconBrowser className="size-5" />
            </span>
            <div>
              <p className="text-body font-medium">Couldn’t load the live browser</p>
              <p className="mt-1 text-meta font-medium text-muted-foreground">
                The task keeps running. Try again in a moment.
              </p>
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
              <IconRefreshCw02 aria-hidden className="size-3.5" />
              Try again
            </Button>
          </div>
        </ViewportFrame>
      </div>
    );
  }
  if (state.kind === 'ended') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <ViewportFrame className="bg-foreground">
          {sessionId && !fixture ? (
            <BrowserReplaySurface
              sessionId={sessionId}
              browserbaseSessionId={state.browserbaseSessionId}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-meta font-medium text-background/70">
              Browser replay
            </div>
          )}
        </ViewportFrame>
        <p
          className="shrink-0 text-meta font-medium text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          This browser session ended. The recording appears above once Browserbase has processed it.
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewportFrame className="bg-background">
        <div
          className={cn(
            'absolute inset-0',
            state.browserStatus !== 'user' && 'pointer-events-none',
          )}
        >
          <iframe
            ref={iframeRef}
            title="Live browser"
            src={fixture ? undefined : liveViewSrc(state.debuggerFullscreenUrl)}
            srcDoc={fixture ? FIXTURE_PAGE : undefined}
            sandbox={LIVE_VIEW_SANDBOX}
            allow={LIVE_VIEW_ALLOW}
            tabIndex={state.browserStatus === 'user' ? 0 : -1}
            className="size-full border-0"
          />
        </div>
        <ControlChip driving={state.browserStatus === 'user'} />
      </ViewportFrame>
    </div>
  );
}
