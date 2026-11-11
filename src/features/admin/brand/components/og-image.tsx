'use client';

import { IconImageX } from '@/components/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { OPEN_GRAPH_IMAGE } from '../open-graph';
import { useOgImage } from './og-image-provider';

// Plain <img>, not next/image: the source is a data URL of the bytes the
// route returned, and the optimizer would re-encode them.

export function OgImage({
  alt,
  className,
}: {
  /** Empty inside a share-card preview, where the image is decorative. */
  alt: string;
  className?: string;
}) {
  const state = useOgImage();

  return (
    <div
      className={cn('relative isolate w-full overflow-hidden bg-alpha-6', className)}
      style={{ aspectRatio: `${OPEN_GRAPH_IMAGE.width} / ${OPEN_GRAPH_IMAGE.height}` }}
    >
      {state.kind === 'loading' ? <Skeleton className="absolute inset-0 rounded-none" /> : null}

      {state.kind === 'failed' ? (
        <p className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-meta text-muted-foreground">
          <IconImageX className="size-5" aria-hidden="true" />
          The {OPEN_GRAPH_IMAGE.path} route did not return an image. Reload the page, and check the
          server log for the generator’s error.
        </p>
      ) : null}

      {state.kind === 'ready' ? (
        // eslint-disable-next-line @next/next/no-img-element -- the page exists to show the exact bytes the OG route returns; the optimizer would re-encode them
        <img
          src={state.src}
          alt={alt}
          width={OPEN_GRAPH_IMAGE.width}
          height={OPEN_GRAPH_IMAGE.height}
          className="size-full object-cover"
        />
      ) : null}
    </div>
  );
}
