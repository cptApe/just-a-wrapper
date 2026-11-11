'use client';
import * as React from 'react';
import { isApplePlatform } from '../lib/open-search';

const subscribeNever = () => () => {};

/** The platform modifier key, hydration-safe: the server snapshot renders the
    mac form, the client snapshot corrects it for other platforms on mount. */
export function useModifierKey(): string {
  return React.useSyncExternalStore(
    subscribeNever,
    () => (isApplePlatform() ? '⌘' : 'Ctrl'),
    () => '⌘',
  );
}
