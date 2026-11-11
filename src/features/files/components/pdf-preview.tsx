'use client';

import { useQuery } from '@tanstack/react-query';
import type { RenderTask } from 'pdfjs-dist';
import * as pdfjs from 'pdfjs-dist';
import * as React from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { Spinner } from '@/components/ui/spinner';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability-client';
import { fileQueryKeys } from '../api/keys';
import {
  initialPdfPreview,
  type PdfRenderState,
  pdfPreviewReducer,
} from '../lib/pdf-preview-machine';
import { clampPdfZoom, PDF_ZOOM_STEP, scrollForPdfZoom } from '../lib/pdf-zoom';

// pdf.js paints each page to a canvas from a bundled worker, so previews work in
// webviews with no PDF plugin and under the CSP. Cached bytes are cloned before
// pdf.js reads them because getDocument may detach the buffer it receives.

// Resolve the worker from the installed package via the bundler (Turbopack/
// webpack rewrite `new URL(<request>, import.meta.url)` to an emitted asset URL).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// Preview cap — full documents render on Download; a preview never needs to
// paint hundreds of pages into memory.
const MAX_PAGES = 30;
// Re-render debounce when the canvas (a resizable/placement-toggleable surface)
// changes width, so pages stay crisp instead of CSS-upscaling a stale bitmap.
const RESIZE_DEBOUNCE_MS = 150;

async function fetchPdfBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (cause) {
    // Network fault reaching the CDN — genuinely unexpected for a durable URL.
    throw new AppError('API_REQUEST_FAILED', `pdf bytes network error: ${url}`, { url }, { cause });
  }
  if (!res.ok) {
    // Expired/forbidden CDN URL (e.g. a signed URL past its TTL) — an expected
    // user-facing state, not a bug; flag it so the caller shows the download
    // fallback without adding error-tracking noise.
    throw new AppError('API_REQUEST_FAILED', `pdf bytes failed: HTTP ${res.status}`, {
      url,
      status: res.status,
      expected: true,
    });
  }
  return new Uint8Array(await res.arrayBuffer());
}

// The page column scrolls sideways inside the viewport, but vertical scrolling
// belongs to whichever ancestor the panel gives an overflow (the modal body).
// Pans and zoom anchors must move that element, or vertical drags do nothing.
function verticalScroller(start: HTMLElement): HTMLElement {
  for (let node: HTMLElement | null = start; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return start;
}

export function PdfPreview({
  filename,
  url,
  fallback,
}: {
  filename: string;
  url: string;
  fallback: React.ReactNode;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [state, dispatch] = React.useReducer(pdfPreviewReducer, initialPdfPreview);
  const renderState = state.render;
  const zoomed = state.zoom > 1;
  const dragging = state.gesture.kind === 'drag';
  const instructionsId = React.useId();
  const organizationId = useOrganizationId();

  const bytesQuery = useQuery({
    queryKey:
      organizationId !== null ? fileQueryKeys.text(organizationId, url) : fileQueryKeys.unscoped(),
    queryFn: ({ signal }) => fetchPdfBytes(url, signal),
    enabled: organizationId !== null,
  });
  const bytes = bytesQuery.data;

  React.useEffect(() => {
    if (!bytesQuery.isError) return;
    // An expired or forbidden URL is an expected state, flagged in fetchPdfBytes.
    const expected =
      bytesQuery.error instanceof AppError && bytesQuery.error.context.expected === true;
    if (!expected) captureException(bytesQuery.error, { feature: 'files', op: 'pdf-preview' });
  }, [bytesQuery.isError, bytesQuery.error]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || bytes === undefined) return;

    const attempt = new AbortController();
    let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
    let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']> | null = null;
    // Bumped per render pass so a resize-triggered re-render supersedes an
    // in-flight one instead of interleaving canvases; the active RenderTask is
    // held so a superseded pass can be aborted mid-paint, not left to finish.
    let renderToken = 0;
    let activeRenderTask: RenderTask | null = null;

    async function renderAllPages() {
      if (!doc || !container) return;
      const token = ++renderToken;
      const isStale = () => attempt.signal.aborted || token !== renderToken;
      activeRenderTask?.cancel();
      activeRenderTask = null;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = container.clientWidth || 800;
      const count = Math.min(doc.numPages, MAX_PAGES);
      const rendered: HTMLCanvasElement[] = [];

      for (let n = 1; n <= count; n++) {
        const page = await doc.getPage(n);
        if (isStale()) return;
        const unscaled = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / unscaled.width) * dpr });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        canvas.className = 'w-full rounded-lg border bg-paper';
        rendered.push(canvas);
        const task = page.render({ canvas, viewport });
        activeRenderTask = task;
        try {
          await task.promise;
        } catch (err) {
          // A superseded/torn-down pass rejects via RenderingCancelledException —
          // expected, stop quietly. Anything else is a genuine render failure.
          if (isStale()) return;
          throw err;
        }
        if (isStale()) return;
      }
      if (isStale()) return;
      container.replaceChildren(...rendered);
      setState({ kind: 'ready', pages: count, total: doc.numPages });
    }

    function setState(next: PdfRenderState) {
      if (!attempt.signal.aborted) dispatch({ type: 'render', render: next });
    }

    void (async () => {
      try {
        // Clone the cached bytes: pdf.js may detach/transfer the buffer it is
        // handed, and the same Uint8Array is reused on the next mount from cache.
        loadingTask = pdfjs.getDocument({ data: bytes.slice() });
        doc = await loadingTask.promise;
        if (attempt.signal.aborted) return;
        await renderAllPages();
      } catch (error) {
        // Corrupt/unsupported PDF or a render bug — a genuinely unexpected shape.
        if (attempt.signal.aborted) return;
        captureException(error, { feature: 'files', op: 'pdf-preview' });
        setState({ kind: 'error' });
      }
    })();

    // The surface is resizable and toggles side↔modal; re-render on real width
    // changes so enlargement stays sharp. Debounced, and a no-op until the doc is
    // loaded. renderAllPages only rejects on a genuine render fault (superseded
    // passes return quietly), so capture rather than swallow.
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let lastWidth = container.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      if (!doc || width === lastWidth) return;
      lastWidth = width;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (attempt.signal.aborted) return;
        renderAllPages().catch((error) => {
          captureException(error, { feature: 'files', op: 'pdf-preview-resize' });
          setState({ kind: 'error' });
        });
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(container);

    return () => {
      attempt.abort();
      observer.disconnect();
      clearTimeout(debounce);
      activeRenderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [bytes]);

  // Zoom lays the page column out at `zoom` × the viewport width and scrolls
  // the viewport so the point under the pointer stays put; the ResizeObserver
  // above then repaints the pages crisp at the new width.
  const applyZoom = React.useCallback(
    (next: number, client: { x: number; y: number }) => {
      const viewport = viewportRef.current;
      const column = containerRef.current;
      if (!viewport || !column) return;
      const zoom = clampPdfZoom(next);
      const ratio = zoom / state.zoom;
      if (ratio === 1) return;
      dispatch({ type: 'zoom', zoom });
      column.style.width = `${zoom * 100}%`;
      const vertical = verticalScroller(viewport);
      const horizontalRect = viewport.getBoundingClientRect();
      const verticalRect = vertical.getBoundingClientRect();
      const scroll = scrollForPdfZoom({
        scrollLeft: viewport.scrollLeft,
        scrollTop: vertical.scrollTop,
        pointer: { x: client.x - horizontalRect.left, y: client.y - verticalRect.top },
        ratio,
      });
      viewport.scrollLeft = scroll.scrollLeft;
      vertical.scrollTop = scroll.scrollTop;
    },
    [state.zoom],
  );

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Pinch on a trackpad arrives as a wheel event with ctrlKey set; plain
    // wheel keeps scrolling the pages.
    function wheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      applyZoom(state.zoom * Math.exp(-event.deltaY * 0.01), {
        x: event.clientX,
        y: event.clientY,
      });
    }
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [applyZoom, state.zoom]);

  if (bytesQuery.isError || renderState.kind === 'error') return <>{fallback}</>;

  const loading = bytes === undefined || renderState.kind === 'loading';

  return (
    <div
      ref={viewportRef}
      role="group"
      aria-label={`PDF preview: ${filename}`}
      aria-describedby={instructionsId}
      tabIndex={0}
      className="h-full overflow-auto overscroll-x-contain rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ cursor: zoomed ? (dragging ? 'grabbing' : 'grab') : undefined }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || event.pointerType === 'touch') return;
        event.currentTarget.focus({ preventScroll: true });
        if (state.zoom === 1) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dispatch({ type: 'drag', pointerId: event.pointerId, x: event.clientX, y: event.clientY });
      }}
      onPointerMove={(event) => {
        const drag = state.gesture;
        if (drag.kind !== 'drag' || drag.pointerId !== event.pointerId) return;
        event.currentTarget.scrollLeft -= event.clientX - drag.x;
        verticalScroller(event.currentTarget).scrollTop -= event.clientY - drag.y;
        dispatch({ type: 'drag', pointerId: event.pointerId, x: event.clientX, y: event.clientY });
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        dispatch({ type: 'release' });
      }}
      onPointerCancel={() => {
        dispatch({ type: 'release' });
      }}
      onDoubleClick={(event) => {
        if (renderState.kind !== 'ready') return;
        applyZoom(state.zoom > 1 ? 1 : 2, { x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (renderState.kind !== 'ready' || event.metaKey || event.ctrlKey || event.altKey) return;
        const zoom =
          event.key === '0'
            ? 1
            : event.key === '+' || event.key === '='
              ? state.zoom * PDF_ZOOM_STEP
              : event.key === '-'
                ? state.zoom / PDF_ZOOM_STEP
                : null;
        if (zoom === null) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        applyZoom(zoom, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
    >
      <span id={instructionsId} className="sr-only">
        Pinch to zoom. Scroll or drag to move around when zoomed. Double-click to toggle fit and
        200%. Use plus and minus to zoom, or 0 to reset.
      </span>
      {loading ? (
        <div
          className="flex h-full min-h-[200px] items-center justify-center"
          aria-busy="true"
          aria-label={`Loading ${filename}`}
        >
          <Spinner className="size-5 text-muted-foreground" aria-hidden />
        </div>
      ) : null}
      <div ref={containerRef} className="flex flex-col items-center gap-3" />
      {renderState.kind === 'ready' && renderState.total > renderState.pages ? (
        <p className="py-3 text-center text-meta text-muted-foreground">
          Showing the first {renderState.pages} of {renderState.total} pages. Download the file for
          all of them.
        </p>
      ) : null}
    </div>
  );
}
