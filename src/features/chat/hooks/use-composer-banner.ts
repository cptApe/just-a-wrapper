'use client';

import { useSyncExternalStore } from 'react';
import {
  getComposerBanners,
  selectActiveBanner,
  subscribeComposerBanners,
} from '../lib/composer-banner-store';
import type { ComposerBanner } from '../types';

// A stable empty array for the server snapshot: the registry is client-only
// (banners are registered by user actions), so on the server there is never a
// banner. Reusing one constant keeps useSyncExternalStore from looping on a
// fresh reference each render.
const NO_BANNERS: ComposerBanner[] = [];

/** The single active composer banner, or null. Producers use the store's register and
 *  dismiss functions directly. */
export function useActiveComposerBanner(omit?: string): ComposerBanner | null {
  const banners = useSyncExternalStore(
    subscribeComposerBanners,
    getComposerBanners,
    () => NO_BANNERS,
  );
  return selectActiveBanner(banners, omit);
}
