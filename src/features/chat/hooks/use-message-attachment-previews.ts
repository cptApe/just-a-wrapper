'use client';
import { useCallback, useEffect, useRef } from 'react';
import type { OptimisticComposerAttachment } from '@/features/sessions/lib/build-composer-message';

/** A send surface owns the previews across pending, failed and echoed renders.
 * Keep them through the echo: swapping to an uncached CDN image flashes blank. */
export function useMessageAttachmentPreviews() {
  const previews = useRef(new Set<string>());
  const lifetime = useRef<symbol | null>(null);
  useEffect(() => {
    const token = Symbol('message-previews');
    lifetime.current = token;
    const owned = previews.current;
    return () => {
      queueMicrotask(() => {
        if (lifetime.current !== token) return;
        for (const url of owned) URL.revokeObjectURL(url);
        owned.clear();
      });
    };
  }, []);
  return useCallback((attachments: OptimisticComposerAttachment[]) => {
    for (const attachment of attachments) {
      if (attachment.previewUrl?.startsWith('blob:')) previews.current.add(attachment.previewUrl);
    }
  }, []);
}
