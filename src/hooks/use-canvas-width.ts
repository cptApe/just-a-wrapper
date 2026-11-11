'use client';
import * as React from 'react';
import { z } from 'zod';
import { canvasReducer } from '@/components/ui/lib/canvas-machine';
import { useMediaQuery } from './use-media-query';

const CANVAS_MIN_W = 420;
// Keep at least a strip of the page visible so the canvas reads as "beside
// the page", never a takeover.
const CANVAS_PAGE_GUTTER = 280;

// Floating canvases share space with the page above the push breakpoint.
// The layout shrinks by --overlay-canvas-push so content reflows beside the card.
// Below that breakpoint the same inset card floats over content; the viewport
// chooses this behavior, never a stored preference.
const FLOATING_CANVAS_MIN_W = 380;
// The card may take at most ~55vw, so the page always keeps ≥45vw.
const FLOATING_CANVAS_MAX_FRACTION = 0.55;
// right-3 / inset-y-3 — the card's edge inset; doubled for the push so the
// content→card gap mirrors the card→edge gap.
export const CANVAS_EDGE_GAP = 12;
// Push only when sidebar (264) + a usable content column (~520) + the
// content→card gap (12) + the narrowest card (380) + its edge insets (2×12)
// still fit: 264 + 520 + 12 + 380 + 24 = 1200. Below that, pushing would
// squeeze content past usefulness, so the card floats over it instead.
const CANVAS_PUSH_MIN_VIEWPORT = 1200;
const CANVAS_WIDTH_STORAGE_KEY = 'overlay:canvas-width';

function readStoredCanvasWidth(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(CANVAS_WIDTH_STORAGE_KEY);
  if (raw === null) return null;
  const parsed = z.coerce.number().positive().safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// While a floating canvas is open at push-capable widths, these root CSS vars
// drive .canvas-push-region (src/app/globals.css). A Map rather than a single
// value: two canvases can briefly coexist (a preview overlay opened over the
// composer's attach canvas) — the most recently updated one drives the var and
// closing either leaves the other's push intact.
const canvasPushEntries = new Map<number, number>();
let canvasPushNextId = 0;

function syncCanvasPush(instant: boolean): void {
  const widths = [...canvasPushEntries.values()];
  const push = widths.at(-1) ?? 0;
  const root = document.documentElement;
  root.style.setProperty('--overlay-canvas-push', `${push}px`);
  // Mirrors the canvas motion (500ms in / 300ms out); instant
  // while dragging so content tracks the handle without lagging behind it.
  root.style.setProperty(
    '--overlay-canvas-push-duration',
    instant ? '0ms' : push > 0 ? '500ms' : '300ms',
  );
}

export function useCanvasWidth({
  width,
  defaultWidth,
  floating,
  presentation,
  open,
}: {
  width: number | undefined;
  defaultWidth: number;
  floating: boolean;
  presentation: string;
  open: boolean;
}) {
  const fixedWidth = width !== undefined;
  const initialWidth =
    width !== undefined
      ? width
      : floating
        ? (readStoredCanvasWidth() ?? defaultWidth)
        : defaultWidth;
  const [state, dispatch] = React.useReducer(canvasReducer, {
    kind: 'idle',
    width: initialWidth,
    dirty: false,
  });
  const [viewportWidth, setViewportWidth] = React.useState(() =>
    typeof window === 'undefined' ? 1200 : window.innerWidth,
  );
  React.useEffect(() => {
    if (presentation !== 'canvas' || !open || fixedWidth) return;
    const measure = () => setViewportWidth(window.innerWidth);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [presentation, open, fixedWidth]);
  const resizing = state.kind === 'resizing';
  function setResizing(active: boolean) {
    dispatch({ type: active ? 'start' : 'finish' });
  }
  React.useEffect(() => {
    if (!open || presentation !== 'canvas') dispatch({ type: 'close' });
  }, [open, presentation]);
  React.useEffect(() => {
    if (!floating || fixedWidth || !open) return;
    const sync = () => {
      const stored = readStoredCanvasWidth();
      if (stored !== null) dispatch({ type: 'restore', width: stored });
    };
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('canvas-width-change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('canvas-width-change', sync);
    };
  }, [floating, fixedWidth, open]);
  React.useEffect(() => {
    if (floating && !fixedWidth && state.kind === 'idle' && state.dirty) {
      window.localStorage.setItem(CANVAS_WIDTH_STORAGE_KEY, String(Math.round(state.width)));
      dispatch({ type: 'persisted' });
      window.dispatchEvent(new Event('canvas-width-change'));
    }
  }, [floating, fixedWidth, state]);

  const isCanvas = presentation === 'canvas';
  const isFloatingCanvas = isCanvas && floating;

  const minWidth = floating ? FLOATING_CANVAS_MIN_W : CANVAS_MIN_W;
  const maxWidth = floating
    ? Math.max(FLOATING_CANVAS_MIN_W, Math.floor(viewportWidth * FLOATING_CANVAS_MAX_FRACTION))
    : Math.max(CANVAS_MIN_W, viewportWidth - CANVAS_PAGE_GUTTER);
  const clampWidth = (next: number) => Math.min(Math.max(next, minWidth), maxWidth);

  // Floating canvases mount client-side, so the first client render is truthful.
  const wideEnoughToPush = useMediaQuery(`(min-width: ${CANVAS_PUSH_MIN_VIEWPORT}px)`, false);

  const canvasWidth = fixedWidth ? width : clampWidth(state.width);

  function applyUserResize(apply: (width: number) => number) {
    dispatch({ type: 'width', width: clampWidth(apply(canvasWidth)) });
  }

  const pushWidth =
    isFloatingCanvas && open && wideEnoughToPush ? canvasWidth + CANVAS_EDGE_GAP * 2 : null;
  const pushIdRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (pushWidth === null) return undefined;
    const id = (pushIdRef.current ??= canvasPushNextId++);
    canvasPushEntries.set(id, pushWidth);
    syncCanvasPush(resizing);
    return () => {
      canvasPushEntries.delete(id);
      syncCanvasPush(false);
    };
  }, [pushWidth, resizing]);

  return { canvasWidth, minWidth, maxWidth, resizing, setResizing, applyUserResize };
}
