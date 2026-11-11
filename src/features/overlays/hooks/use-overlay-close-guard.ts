'use client';
import { useCallback, useEffect, useRef } from 'react';
import { preventOverlayClose } from '../lib/overlay-history';
export function useOverlayCloseGuard(pending: boolean): () => void {
  const release = useRef<(() => void) | null>(null);
  const clear = useCallback(() => {
    release.current?.();
    release.current = null;
  }, []);
  useEffect(() => {
    if (pending) release.current = preventOverlayClose();
    return clear;
  }, [pending, clear]);
  return clear;
}
