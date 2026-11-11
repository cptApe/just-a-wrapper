'use client';

import Image from 'next/image';
import { type ReactNode, useState } from 'react';
import { IconBrandSquare } from '@/components/icons/brand';
import { cn } from '@/lib/utils';

// Override toolkit logos only for incorrect upstream assets.
// Use bundled brand marks for those slugs and keep the map narrowly scoped.
const BRAND_LOGO_OVERRIDES: Record<string, typeof IconBrandSquare> = {
  square: IconBrandSquare,
};

/**
 * Catalog logo with a monogram fallback: no vetted URL, or the CDN failing to
 * serve it, degrades to the integration's initial — never a broken-image glyph.
 * A slug with a known-bad Composio asset is overridden with a bundled brand mark.
 */
export function IntegrationLogo({
  logoUrl,
  name,
  size,
  slug,
  imagePadding = 'p-1.5',
  imageRounding = 'rounded-md',
  fallback,
}: {
  logoUrl: string | null;
  name: string;
  size: number;
  slug?: string;
  /** Inset between the white tile edge and the logo mark. Defaults to the
      grid/modal look; a small tile (e.g. the command menu row) tightens this so
      the mark still reads bold, near-filling the tile. Applies to the CDN image
      and the bundled brand override — not the text-monogram fallback. */
  imagePadding?: string;
  /** Border radius applied to the logo tile and image. */
  imageRounding?: string;
  /** Replaces the monogram when the caller has a more suitable fallback. */
  fallback?: ReactNode;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const failed = failedSrc === logoUrl;
  const loaded = loadedSrc === logoUrl;

  const Brand = slug ? BRAND_LOGO_OVERRIDES[slug] : undefined;
  if (Brand) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center bg-paper text-paper-foreground',
          imagePadding,
          imageRounding,
        )}
        style={{ width: size, height: size }}
      >
        <Brand className="h-full w-full" />
      </div>
    );
  }

  if (!logoUrl || failed) {
    if (fallback !== undefined) return fallback;
    return (
      <div
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center bg-alpha-6 text-body font-semibold text-muted-foreground',
          imageRounding,
        )}
        style={{ width: size, height: size }}
      >
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative shrink-0',
        imageRounding,
        loaded ? 'bg-paper' : fallback === undefined && 'bg-alpha-6',
      )}
      style={{ width: size, height: size }}
    >
      {!loaded && fallback !== undefined ? (
        <span className="absolute inset-0 flex items-center justify-center">{fallback}</span>
      ) : null}
      <Image
        key={logoUrl}
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        unoptimized
        className={cn(
          'size-full object-contain',
          imagePadding,
          imageRounding,
          !loaded && 'opacity-0',
        )}
        onLoad={() => setLoadedSrc(logoUrl)}
        onError={() => setFailedSrc(logoUrl)}
      />
    </div>
  );
}
