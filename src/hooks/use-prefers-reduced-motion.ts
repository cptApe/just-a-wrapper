'use client';
// The animated path is the server default.

import { useMediaQuery } from './use-media-query';

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)', false);
}
