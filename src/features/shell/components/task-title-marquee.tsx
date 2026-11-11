'use client';

import { useCallback } from 'react';

const MARQUEE_DELAY_MS = 650;
const MARQUEE_EASING = 'linear';
const MARQUEE_MIN_DURATION_MS = 1_000;
const MARQUEE_PIXELS_PER_SECOND = 30;
const PRECISE_HOVER_QUERY = '(hover: hover) and (pointer: fine)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function TaskTitleMarquee({ title }: { title: string }) {
  const bindMarquee = useCallback((viewport: HTMLSpanElement | null) => {
    if (!viewport) return;
    const idleTitleElement = viewport.querySelector<HTMLElement>('[data-task-title-idle]');
    const trackElement = viewport.querySelector<HTMLElement>('[data-task-title-track]');
    const row = viewport.closest('li');
    if (!idleTitleElement || !trackElement || !row) return;
    const idleTitle = idleTitleElement;
    const track = trackElement;
    const viewportElement = viewport;

    let animation: Animation | null = null;
    let delayTimer: number | null = null;

    function reset() {
      if (delayTimer !== null) window.clearTimeout(delayTimer);
      delayTimer = null;
      animation?.cancel();
      animation = null;
      idleTitle.style.visibility = 'visible';
      track.style.visibility = 'hidden';
    }

    function start() {
      reset();
      if (
        !window.matchMedia(PRECISE_HOVER_QUERY).matches ||
        window.matchMedia(REDUCED_MOTION_QUERY).matches
      ) {
        return;
      }

      const overflow = track.scrollWidth - viewportElement.clientWidth;
      if (overflow <= 0) return;

      const duration = Math.max(
        MARQUEE_MIN_DURATION_MS,
        (overflow / MARQUEE_PIXELS_PER_SECOND) * 1_000,
      );
      delayTimer = window.setTimeout(() => {
        delayTimer = null;
        idleTitle.style.visibility = 'hidden';
        track.style.visibility = 'visible';
        animation = track.animate(
          [{ transform: 'translateX(0)' }, { transform: `translateX(-${overflow}px)` }],
          { duration, easing: MARQUEE_EASING, fill: 'forwards' },
        );
      }, MARQUEE_DELAY_MS);
    }

    row.addEventListener('pointerenter', start);
    row.addEventListener('pointerleave', reset);
    return () => {
      row.removeEventListener('pointerenter', start);
      row.removeEventListener('pointerleave', reset);
      reset();
    };
  }, []);

  return (
    <span ref={bindMarquee} className="relative min-w-0 flex-1 overflow-hidden whitespace-nowrap">
      <span data-task-title-idle className="block truncate">
        {title}
      </span>
      <span
        aria-hidden
        data-task-title-track
        className="invisible absolute left-0 top-0 inline-block min-w-full w-max whitespace-nowrap"
      >
        {title}
      </span>
    </span>
  );
}
