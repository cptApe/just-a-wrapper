'use client';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import {
  buildOverlayHash,
  isOverlayHash,
  type OverlayHash,
  openOverlay,
} from '@/features/overlays';
import type { StaticCommand } from '../types';

export function useSearchNavigation(close: () => void) {
  const router = useRouter();
  const pathname = usePathname();
  // Next push emits no hash event; open the overlay only after its target pathname commits.
  // Discard a pending overlay if navigation lands elsewhere.
  const pendingOverlay = React.useRef<{ path: string; hash: OverlayHash } | null>(null);
  React.useEffect(() => {
    const pending = pendingOverlay.current;
    if (!pending) return;
    pendingOverlay.current = null;
    if (pathname === pending.path) openOverlay(pending.hash);
  }, [pathname]);

  function navigate(href: string) {
    close();
    const hashIndex = href.indexOf('#');
    const hash = href.slice(hashIndex + 1);
    if (hashIndex === -1 || !isOverlayHash(hash)) {
      router.push(href);
      return;
    }
    const target = href.slice(0, hashIndex);
    const targetPath = target.slice(0, target.includes('?') ? target.indexOf('?') : target.length);
    if (pathname === targetPath) {
      // Apply the page query before opening its overlay so the backdrop matches the destination.
      if (target.includes('?')) {
        window.history.replaceState(null, '', target);
      }
      openOverlay(hash);
      return;
    }
    pendingOverlay.current = { path: targetPath, hash };
    router.push(target);
  }

  function runStatic(command: StaticCommand) {
    close();
    if (command.action.type === 'navigate') {
      router.push(command.action.href);
    } else {
      openOverlay(buildOverlayHash(command.action.token));
    }
  }

  return { navigate, runStatic };
}
