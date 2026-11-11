// Shared in-memory composer banners follow the user across Home and Task.
// Producers register conditions; the slot renders one priority winner.
// Registration and dismissal are session-local, without persistence.

import type { ComposerBanner, ComposerBannerKind } from '../types';

// Show one banner; lowest priority number wins. Billing precedes connection
// and workspace because it prevents starting work.
const KIND_PRIORITY: Record<ComposerBannerKind, number> = {
  billing: 0,
  connection: 1,
  workspace: 2,
};

let banners: ComposerBanner[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to registry changes (used by the slot via useSyncExternalStore). */
export function subscribeComposerBanners(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current candidates. A stable reference between mutations, so
 *  useSyncExternalStore only re-renders when the set actually changes. */
export function getComposerBanners(): ComposerBanner[] {
  return banners;
}

/** Add or replace a candidate, keyed by id. Re-registering after a dismiss is
 *  how a condition that fires again (the next 402) brings the banner back. */
export function registerComposerBanner(banner: ComposerBanner): void {
  banners = [...banners.filter((existing) => existing.id !== banner.id), banner];
  emit();
}

/** Remove a candidate — the user dismissed it, or the producer's condition
 *  resolved. Hidden for the session; only a fresh register brings it back. A
 *  no-op when the id isn't registered keeps the notify budget accurate. */
export function dismissComposerBanner(id: string): void {
  if (!banners.some((banner) => banner.id === id)) return;
  banners = banners.filter((banner) => banner.id !== id);
  emit();
}

/** The single winning banner: highest priority among the registered candidates, leaving out
 *  `omit` when a richer surface already says the same thing. Pure, so safe in render. */
export function selectActiveBanner(
  candidates: ComposerBanner[],
  omit?: string,
): ComposerBanner | null {
  let best: ComposerBanner | null = null;
  for (const candidate of candidates) {
    if (candidate.id === omit) continue;
    if (best === null || KIND_PRIORITY[candidate.kind] < KIND_PRIORITY[best.kind]) {
      best = candidate;
    }
  }
  return best;
}

export const CREDITS_EXHAUSTED_BANNER_ID = 'credits-exhausted';
