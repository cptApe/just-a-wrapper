'use client';

import { useSyncExternalStore } from 'react';

const emptySubscribe = () => () => {};

// Hydration detector without effect-driven setState: the server snapshot is
// false, the client snapshot true, so React swaps to "hydrated" right after
// mount — exactly when client-only state (e.g. next-themes' stored preference)
// becomes readable.
export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
