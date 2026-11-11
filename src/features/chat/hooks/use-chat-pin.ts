'use client';
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import type { useMessageScroller } from '@/components/ui/message-scroller';
import type { PendingSend } from '../components/pending-bubble';
import { type PinRoomCompensation, pinScrollMargin } from '../components/pin-room-spacer';
import type { ChatTurn } from '../lib/chat-state';
import { pinReducer } from '../lib/pin-machine';

export function useChatPin({
  scrollToMessage,
  turns,
  pending,
  pinPending,
  pinBehavior,
  lastTurnKey,
}: {
  scrollToMessage: ReturnType<typeof useMessageScroller>['scrollToMessage'];
  turns: ChatTurn[];
  pending: PendingSend[];
  pinPending: boolean;
  pinBehavior: 'auto' | 'smooth';
  lastTurnKey: string | null;
}) {
  // A thin read-only handle onto the primitive's free jump-to-message capability
  // used by the live scroll-contract e2e. It is NOT part of the product
  // surface, so it is kept out of the default production bundle: exposed in dev,
  // or in an explicit `NEXT_PUBLIC_E2E=1` build so a prod-with-flag server can
  // still be exercised. Both env reads are inlined at build time, so the default
  // production build tree-shakes this effect away.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_E2E !== '1') return;
    window.__chatScroll = { scrollToMessage };
    return () => {
      window.__chatScroll = undefined;
    };
  }, [scrollToMessage]);

  // On send → the new turn glides up to its park position (pinScrollMargin
  // below the top, previous pair peeking above). We drive this through the
  // primitive's imperative `scrollToMessage` rather than its scroll-anchor auto-
  // pin: our optimistic bubble reconciles into a relay-echoed turn asynchronously
  // and the auto-anchor does not fire reliably across that swap. `scrollToMessage`
  // flips the primitive into its "settling-jump" mode, so the send takes over
  // scroll ownership and streaming will not drag the viewport away. Two-phase:
  // pin once when the optimistic bubble appears, and again when its echoed turn
  // replaces it — the pin request lives across the reconciliation.
  const lastTurnAnchor = turns.at(-1)?.items.at(0);
  const lastLocalTurnKey =
    lastTurnAnchor?.type === 'message' ? (lastTurnAnchor.localId ?? null) : null;
  const [pin, dispatchPin] = useReducer(pinReducer, {
    phase: { kind: 'idle' },
    pendingCount: 0,
    localTurn: null,
  });
  if (pin.pendingCount !== pending.length || pin.localTurn !== lastLocalTurnKey)
    dispatchPin({
      type: 'observe',
      pendingCount: pending.length,
      localTurn: lastLocalTurnKey,
      turn: lastTurnKey,
      shouldPin: pinPending,
    });
  const pinnedKey =
    pin.phase.kind === 'idle' ? null : pin.phase.kind === 'pending' ? '__pending__' : pin.phase.key;
  useEffect(() => {
    if (pinnedKey !== null)
      scrollToMessage(pinnedKey, {
        align: 'start',
        behavior: pinBehavior,
        scrollMargin: pinScrollMargin(),
      });
  }, [pinnedKey, scrollToMessage, pinBehavior]);
  const pinRoomCompensationRef = useRef<PinRoomCompensation | null>(null);
  const collapsePinRoom = useCallback(() => {
    dispatchPin({ type: 'collapse' });
  }, []);
  const releasePinRoom = useCallback((compensation: PinRoomCompensation) => {
    pinRoomCompensationRef.current = compensation;
    dispatchPin({ type: 'collapse' });
  }, []);
  useLayoutEffect(() => {
    if (pinnedKey !== null) return;
    const compensation = pinRoomCompensationRef.current;
    if (!compensation) return;
    pinRoomCompensationRef.current = null;
    compensation.viewport.scrollTop = Math.max(
      0,
      compensation.scrollTop - compensation.removedHeight,
    );
  }, [pinnedKey]);

  return { pinnedKey, collapsePinRoom, releasePinRoom };
}
