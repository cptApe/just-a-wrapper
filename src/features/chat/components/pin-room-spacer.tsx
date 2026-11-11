'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';

/** Where a fresh send parks (scrollMargin on the pin jump): ~210px below the
 *  viewport top on desktop (+ the content's ~24px top padding ≈ 440px), clamped
 *  to 35% of the viewport on short/mobile screens — so the previous message
 *  pair stays visible above the new turn instead of pinning
 *  it flush to the top. The pin-room min-height on the pinned MessageGroup
 *  mirrors this offset (`PIN_ROOM_CLASS` — same 210px/17.5 pair) so the reserved
 *  reply space still ends at the viewport bottom; drift between the two shows
 *  up as either a short pin (message parks too low) or a scroll-to-bottom
 *  button appearing right after send. A thread too short to scroll clamps to
 *  scrollTop 0 naturally — the first turn of a task stays at the top.
 *
 *  The room is TEMPORARY: it exists to hold the pin
 *  steady while the reply lands, then collapses at the first safe moment —
 *  once the turn has settled AND the unused reserve sits fully below the
 *  viewport (`PinRoomSpacer` watches for that via an IntersectionObserver).
 *  Removing space that is entirely below what's on screen shifts nothing, so
 *  the collapse is invisible; scroll back down and the dead gap is gone. */
const PIN_OFFSET_MAX_PX = 210;

const PIN_OFFSET_VIEWPORT_FRACTION = 0.175;

export const PIN_ROOM_CLASS = 'min-h-[calc(100dvh-16rem-min(210px,17.5dvh))]';

export function pinScrollMargin(): number {
  return Math.min(PIN_OFFSET_MAX_PX, Math.round(window.innerHeight * PIN_OFFSET_VIEWPORT_FRACTION));
}

export type PinRoomCompensation = {
  viewport: HTMLElement;
  scrollTop: number;
  removedHeight: number;
};

/** The measurable tail of the pin room. An empty flex-1 child of the pinned
 *  MessageGroup, so its box is exactly the reserve the turn's content hasn't
 *  filled (zero once the reply outgrows PIN_ROOM_CLASS); -mt-3 cancels the
 *  gap-3 slot it would otherwise add, so the group's natural height is
 *  untouched. Once `armed` (the turn settled — no reply streaming in), an
 *  IntersectionObserver against the scroller viewport calls `onStale` the
 *  moment the reserve is fully below the viewport: the one geometry where
 *  dropping it cannot move anything visible (content above stays put, the
 *  scroll position stays valid — only scrollHeight shrinks). While the turn
 *  is live, or while the user is still parked on the gap, nothing fires. */
export function PinRoomSpacer({
  armed,
  release,
  onStale,
  onRelease,
}: {
  armed: boolean;
  release: boolean;
  onStale: () => void;
  onRelease: (compensation: PinRoomCompensation) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!release) return;
    const node = ref.current;
    if (!node) return;
    const viewport = node.closest('[data-slot="message-scroller-viewport"]');
    if (!(viewport instanceof HTMLElement)) {
      onStale();
      return;
    }
    const spacerRect = node.getBoundingClientRect();
    const viewportBottom = viewport.getBoundingClientRect().bottom;
    if (spacerRect.height > 0 && spacerRect.top < viewportBottom) {
      onRelease({
        viewport,
        scrollTop: viewport.scrollTop,
        removedHeight: spacerRect.height,
      });
      return;
    }
    onStale();
  }, [onRelease, onStale, release]);

  useEffect(() => {
    if (!armed || release) return;
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (!entry) return;
        const rootBottom = entry.rootBounds?.bottom;
        // Fully below the viewport — not merely offscreen (above would jump).
        if (
          !entry.isIntersecting &&
          rootBottom !== undefined &&
          entry.boundingClientRect.top >= rootBottom
        ) {
          onStale();
        }
      },
      // Arming fires an initial entry, so a settle that happens after the user
      // already scrolled away collapses immediately — no scroll event needed.
      { root: node.closest('[data-slot="message-scroller-viewport"]') },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [armed, onStale, release]);
  return <div ref={ref} aria-hidden className="-mt-3 min-h-0 flex-1" />;
}
