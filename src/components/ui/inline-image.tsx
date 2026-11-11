'use client';

import { useReducer } from 'react';
import { cn } from '@/lib/utils';
import { imageReducer } from './lib/image-machine';

type InlineImageProps = {
  src: string;
  alt: string;
  onOpen?: () => void;
  /** Width divided by height of the reserved frame. Defaults to 4:3. */
  aspectRatio?: number;
  className?: string;
  testId?: string;
  loadingOnly?: boolean;
};

const DEFAULT_INLINE_IMAGE_ASPECT_RATIO = 4 / 3;

/** Shared image geometry for chat. The frame owns a real width (so it keeps its
 * size inside shrink-to-fit parents) and a fixed aspect ratio, so streaming,
 * loading, and broken images all take the same space. The taller side is capped
 * at 240px on small screens and 360px from `sm`, whichever way the image faces.
 * Load state is keyed to the current `src`, so a replaced image never shows the
 * previous one's ready or error state. Each caller owns identity and routing. */
export function InlineImage({
  src,
  alt,
  onOpen,
  aspectRatio = DEFAULT_INLINE_IMAGE_ASPECT_RATIO,
  className,
  testId = 'inline-image',
  loadingOnly = false,
}: InlineImageProps) {
  const [loaded, dispatch] = useReducer(imageReducer, { kind: 'loading', src });
  if (loaded.src !== src) dispatch({ type: 'source', src });
  const ratio = aspectRatio > 0 ? aspectRatio : DEFAULT_INLINE_IMAGE_ASPECT_RATIO;
  const frame = cn(
    'relative block max-w-full overflow-hidden rounded-xl bg-alpha-6',
    '[--inline-image-cap:240px] sm:[--inline-image-cap:360px]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    className,
  );
  // Landscape and square frames take the cap as their width, so the height
  // never exceeds it. Portrait frames scale the width down, so the HEIGHT lands
  // exactly on the cap instead of overshooting it.
  const style = {
    aspectRatio: String(ratio),
    width: `calc(var(--inline-image-cap) * ${Math.min(ratio, 1)})`,
  };
  const content = (
    <>
      {loaded.kind === 'error' && !loadingOnly ? (
        <span className="absolute inset-0 flex items-center justify-center px-4 text-center text-meta font-normal text-muted-foreground">
          Image couldn’t be loaded
        </span>
      ) : loadingOnly ? null : (
        // eslint-disable-next-line @next/next/no-img-element -- chat images may use authenticated or durable external sources
        <img
          // A fresh element per source, so the browser never keeps showing the
          // previous image while the replacement is still downloading.
          key={src}
          src={src}
          alt={alt}
          className={cn(
            'absolute inset-0 size-full object-contain',
            loaded.kind === 'loading' && 'opacity-0',
          )}
          ref={(element) => {
            // An image that finished before React attached its handlers (cached
            // or server-rendered) never fires `load`; read the element instead.
            if (loaded.kind === 'loading' && element?.complete && element.naturalWidth > 0) {
              dispatch({ src, type: 'ready' });
            }
          }}
          onLoad={() => dispatch({ src, type: 'ready' })}
          onError={() => dispatch({ src, type: 'error' })}
          data-testid={`${testId}-content`}
        />
      )}
      {loaded.kind === 'loading' || loadingOnly ? (
        <span
          aria-hidden
          className={cn(
            'absolute inset-0 bg-[length:200%_100%]',
            'bg-[linear-gradient(115deg,transparent_35%,var(--color-alpha-8)_50%,transparent_65%)]',
            'animate-[tw-shimmer_1.8s_ease-in-out_infinite] motion-reduce:animate-none',
          )}
        />
      ) : null}
    </>
  );

  if (onOpen && loaded.kind !== 'error') {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={frame}
        style={style}
        aria-label={`Open ${alt}`}
        data-testid={testId}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={frame} style={style} data-testid={testId}>
      {content}
    </span>
  );
}
