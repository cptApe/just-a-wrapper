'use client';

import { cn } from '@/lib/utils';

// The "shimmer treatment" skeleton for generate_image / generate_video while
// they run: a rounded-sm box at the media's FINAL aspect ratio — so the real
// image/clip lands with no layout shift — under a diagonal highlight that
// sweeps across on a ~1.8s loop. The words ("Creating an image", shimmering)
// are the activity line above it. This is a DELIBERATE exception to the house
// skeleton (ui/skeleton.tsx keeps a plain pulse "so it doesn't read AI app");
// the generated-media card is exactly where that signature is wanted.
//
// The sizing class (an aspect ratio plus a min()-capped width) reproduces exactly
// what the settled media resolves to — max-h-80 capped, width from the ratio,
// shrinking to the container on narrow screens — so the box holds an identical
// footprint when the media replaces it, at every width (no layout shift). The
// sweep reuses the shared `tw-shimmer` keyframe (globals.css) — background-position,
// no layout work. Under prefers-reduced-motion the sweep layer is dropped
// (motion-reduce:hidden), leaving a static muted placeholder.

export function MediaShimmer({ sizeClassName }: { sizeClassName: string }) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-xl bg-alpha-6', sizeClassName)}
      data-testid="media-shimmer"
    >
      <div
        aria-hidden
        className={cn(
          'absolute inset-0 bg-[length:200%_100%]',
          'bg-[linear-gradient(115deg,transparent_35%,var(--color-alpha-8)_50%,transparent_65%)]',
          'animate-[tw-shimmer_1.8s_ease-in-out_infinite] motion-reduce:hidden',
        )}
      />
    </div>
  );
}
