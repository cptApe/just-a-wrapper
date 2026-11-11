'use client';
import { useSyncExternalStore } from 'react';
import { env } from '@/lib/env';
import { isLocalBrowserHost } from '../lib/local-browser-host';
import { safeReturnTo } from '../lib/return-to';

const subscribeToNothing = () => () => {};
// The validated flag and runtime hostname jointly gate the local sign-in link.
export function useAuthNavigation(returnTo: string | undefined) {
  const returnToPath = safeReturnTo(returnTo);
  const devSignInVisible = useSyncExternalStore(
    subscribeToNothing,
    () =>
      env.NEXT_PUBLIC_ENABLE_DEV_ROUTES === 'true' && isLocalBrowserHost(window.location.hostname),
    () => false,
  );
  return { returnToPath, afterAuth: returnToPath ?? '/app', devSignInVisible };
}
