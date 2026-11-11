'use client';

import { useSyncExternalStore } from 'react';
import {
  INACTIVE_THEME_EDIT_STATE,
  readThemeEditState,
  subscribeThemeEditState,
} from '../lib/theme-edit-storage';
import type { ThemeEditState } from '../types';

// Hydration-safe read of edit mode: the server snapshot is "not editing", so
// the first client render matches the HTML and the stored state takes over
// right after hydration (the same shape as useHydrated).
export function useThemeEditState(): ThemeEditState {
  return useSyncExternalStore(
    subscribeThemeEditState,
    readThemeEditState,
    () => INACTIVE_THEME_EDIT_STATE,
  );
}
