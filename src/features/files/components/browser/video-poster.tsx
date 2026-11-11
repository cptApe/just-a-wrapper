'use client';

import { useEffect, useRef, useState } from 'react';

// The video's first frame is the tile's poster. Each video opens its own byte-range requests,
// so only tiles close to the viewport mount one. The time fragment makes Safari paint a frame.
export function VideoPoster({ src, onError }: { src: string; onError: () => void }) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={frameRef} aria-hidden className="pointer-events-none absolute inset-0 bg-muted">
      {near ? (
        // Uploaded video has no captions track, and the poster never plays.
        <video
          src={`${src}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          disablePictureInPicture
          tabIndex={-1}
          onError={onError}
          className="size-full object-cover"
        />
      ) : null}
    </span>
  );
}
