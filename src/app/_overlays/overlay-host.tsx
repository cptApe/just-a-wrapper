'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';
import {
  closeOverlay,
  OVERLAY_TOKENS,
  type OverlayToken,
  overlayRetentionReducer,
  parseOverlayHash,
  readOverlayHash,
  replaceOverlayHash,
  subscribeOverlayHash,
  syncOverlayHash,
} from '@/features/overlays';
import { OVERLAY_REGISTRY } from './overlay-registry';

// One app-level host resolves hashes to self-loading overlays without unmounting the page.
// Unknown tokens render nothing. Keep closing overlays mounted past the longest
// exit animation so canvas and dialog transitions can finish.
const EXIT_UNMOUNT_MS = 450;

// Fragments never reach the server, so cold-linked overlays open only after hydration.
const getServerSnapshot = () => '';

export function OverlayHost({ only }: { only?: readonly OverlayToken[] }) {
  // Next navigation commits the URL after render without a hash event; resync after commit to close the previous overlay.
  const pathname = usePathname();
  React.useEffect(() => {
    syncOverlayHash();
  }, [pathname]);
  const hash = React.useSyncExternalStore(subscribeOverlayHash, readOverlayHash, getServerSnapshot);

  const knownTokens = only ?? OVERLAY_TOKENS;
  const parsed = React.useMemo(() => parseOverlayHash(hash, knownTokens), [hash, knownTokens]);
  const resolved = React.useMemo(
    () => (parsed ? { ...parsed, Component: OVERLAY_REGISTRY[parsed.token] } : null),
    [parsed],
  );

  const [retention, dispatchRetention] = React.useReducer(
    overlayRetentionReducer<NonNullable<typeof resolved>>,
    { kind: 'closed' },
  );
  if (resolved !== null && (retention.kind !== 'open' || retention.value !== resolved))
    dispatchRetention({ type: 'open', value: resolved });
  if (resolved === null && retention.kind === 'open') dispatchRetention({ type: 'close' });
  React.useEffect(() => {
    if (retention.kind !== 'closing') return;
    const timer = window.setTimeout(
      () => dispatchRetention({ type: 'release', value: retention.value }),
      EXIT_UNMOUNT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [retention]);

  const active = resolved ?? (retention.kind === 'closed' ? null : retention.value);
  if (active === null) return null;
  const { Component } = active;

  return (
    <Component
      key={active.token}
      id={active.id}
      params={active.params}
      open={resolved !== null}
      onClose={closeOverlay}
      onReplaceHash={replaceOverlayHash}
    />
  );
}
