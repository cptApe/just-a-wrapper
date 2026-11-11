'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

const SCROLLED_HAIRLINE = 'border-b border-border';

/**
 * Sticky standard-page toolbar with its lead-in spacing, responsive row, and
 * scroll edge built in. The single sticky wrapper is safe as a flex/grid child:
 * its lead-in sits above the viewport once the toolbar pins at top-0.
 */
export function StickyToolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;

    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(0);
      if (!entry) return;
      setScrolled(!entry.isIntersecting);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    // Below md the header above is only a search row, so the lead-in shrinks
    // to 8px; the sticky offset always equals the lead-in height.
    <div className="sticky -top-2 z-sticky md:-top-5">
      <div aria-hidden className="relative h-2 md:h-5">
        <div ref={sentinelRef} className="absolute inset-x-0 bottom-px h-px" />
      </div>
      <div
        data-scroll-edge={scrolled ? 'scrolled' : 'rest'}
        className={cn('relative bg-background', className)}
      >
        <div className="mx-auto w-full max-w-page px-4 py-3 sm:px-6 md:px-10">
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {children}
          </div>
        </div>
        {scrolled ? (
          <div
            aria-hidden
            className={cn('pointer-events-none absolute inset-x-0 bottom-0', SCROLLED_HAIRLINE)}
          />
        ) : null}
      </div>
    </div>
  );
}
