'use client';
import { useEffect } from 'react';
import { buildOverlayHash, closeOverlayInPlace, openOverlay } from '@/features/overlays';
import { type BrowserPanelState, browserPanelReducer } from '../lib/browser-panel-machine';
import type { ChatState } from '../lib/chat-state';
import { useMachineStore } from './use-machine-store';

export function useChatBrowser({
  state,
  sessionId,
  canWrite,
}: {
  state: ChatState;
  sessionId: string;
  canWrite: boolean;
}) {
  const { dispatch, getSnapshot } = useMachineStore<
    BrowserPanelState,
    Parameters<typeof browserPanelReducer>[1]
  >(() => ({ kind: 'watching', handled: new Set(), command: 'none' }), browserPanelReducer);
  useEffect(() => {
    if (!canWrite) return;
    const tool = state.items.findLast(
      (item) =>
        item.type === 'tool' &&
        (item.name === 'browse_open' ||
          (item.name === 'browse_close' && item.result !== undefined)),
    );
    if (!tool || tool.type !== 'tool' || !dispatch(tool)) return;
    const browserHash = buildOverlayHash('browser', sessionId);
    const currentHash = window.location.hash.replace(/^#/, '');
    const command = getSnapshot().command;
    if (command === 'close' && currentHash === browserHash) closeOverlayInPlace();
    if (command === 'open' && currentHash === '') openOverlay(browserHash);
  }, [canWrite, sessionId, state.items, dispatch, getSnapshot]);
}
