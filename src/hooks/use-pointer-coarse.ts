'use client';
// The server snapshot renders the hover path until hydration.

import { useMediaQuery } from './use-media-query';

export function usePointerCoarse(): boolean {
  return useMediaQuery('(pointer: coarse)', false);
}
