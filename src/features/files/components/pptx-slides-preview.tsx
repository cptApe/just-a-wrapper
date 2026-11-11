'use client';

import { useEffect, useRef, useState } from 'react';
import { captureException } from '@/lib/observability-client';
import { OfficePreviewSkeleton } from './office-preview-skeleton';
import { PreviewNotice } from './preview-notice';

// The renderer and its chart runtime load only when a deck opens. Windowed mounting keeps long
// decks light; zip limits refuse crafted archives before they expand in the browser.
export function PptxSlidesPreview({
  bytes,
  filename,
  download,
}: {
  bytes: ArrayBuffer;
  filename: string;
  download: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const abort = new AbortController();
    let close: (() => void) | null = null;
    import('@aiden0z/pptx-renderer')
      .then(({ PptxViewer, RECOMMENDED_ZIP_LIMITS }) =>
        PptxViewer.open(bytes.slice(0), container, {
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          fitMode: 'contain',
          lazySlides: true,
          lazyMedia: true,
          pdfjs: false,
          scrollContainer: container,
          listOptions: { windowed: true, initialSlides: 4, batchSize: 4 },
          signal: abort.signal,
        }),
      )
      .then((viewer) => {
        if (abort.signal.aborted) {
          viewer.destroy();
          return;
        }
        close = () => viewer.destroy();
        setState('ready');
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        captureException(error, { feature: 'artifacts', op: 'pptx-preview-render' });
        setState('error');
      });
    return () => {
      abort.abort();
      close?.();
    };
  }, [bytes]);

  if (state === 'error') {
    return (
      <PreviewNotice
        title="Couldn’t preview this deck"
        message="The slides could not be read. Download the deck to open it instead."
        action={download}
      />
    );
  }
  return (
    <div className="relative h-full min-h-[200px]">
      {state === 'loading' ? (
        <div className="absolute inset-0">
          <OfficePreviewSkeleton filename={filename} />
        </div>
      ) : null}
      <div ref={containerRef} className="h-full overflow-y-auto overscroll-contain" />
    </div>
  );
}
