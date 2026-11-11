'use client';

import { type RefObject, useLayoutEffect } from 'react';

// Grow the composer textarea with its content between minRows and maxRows
// (1 to 6 rows), then hand over to internal scrolling. Height is the
// one property we must set directly — it's content-driven, not animated (the
// motion rules forbid animating height; the grow is instant by design).

export function useAutosizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  { minRows = 1, maxRows = 6 }: { minRows?: number; maxRows?: number } = {},
): void {
  // useLayoutEffect so the resize lands before paint — no one-frame flash of the
  // old height when a draft restores or a transcript appends several lines.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const styles = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(styles.lineHeight);
    const verticalPadding =
      Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
    const minHeight = lineHeight * minRows + verticalPadding;
    const maxHeight = lineHeight * maxRows + verticalPadding;

    // Collapse first so scrollHeight reports the true content height.
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [ref, value, minRows, maxRows]);
}
