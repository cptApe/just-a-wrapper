'use client';

import { useState } from 'react';
import { IconGlobe01 } from '@/components/icons';
import { cn } from '@/lib/utils';
import { faviconUrl } from '../../lib/tool-display-details';

// A website's favicon at glyph size, for the leading slot of a web line and
// the source chips. The icon comes from the public favicon service by host
// (tool-display faviconUrl); a host with no icon, or a blocked request, falls
// back to the globe glyph so the slot never sits empty.

export function SourceFavicon({ host, className }: { host: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <IconGlobe01 aria-hidden className={cn('size-4 shrink-0', className)} />;
  return (
    /* Plain <img>: a third-party favicon endpoint has no business in the image
       optimizer, and the fallback below covers a miss. */
    // eslint-disable-next-line @next/next/no-img-element -- third-party favicon endpoint, optimizer would only add a proxy hop
    <img
      src={faviconUrl(host)}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn('size-4 shrink-0 rounded-[3px]', className)}
    />
  );
}
