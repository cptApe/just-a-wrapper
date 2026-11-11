'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { IconCursorClick01, IconHand } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { PreviewSurface } from '@/components/ui/preview-surface';
import type { OverlayComponentProps } from '@/features/overlays/types';
import { fetchJson } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import {
  type BrowserPanelView,
  browserPanelViewSchema,
  INITIAL_BROWSER_PANEL_STATE,
  nextBrowserPanelPoll,
  reduceBrowserPanel,
} from '../lib/browser-panel-state';

import { BrowserPanelBody, PanelMeta } from './browser-panel-content';

// The embed contract is Browserbase's documented one (docs.browserbase.com
// /features/session-live-view): sandbox="allow-same-origin allow-scripts",
// allow="clipboard-read; clipboard-write", read-only = pointer-events: none
// on the frame, interactive = remove it, and the page posts the string
// "browserbase-disconnected" when the remote browser ends.
const DISCONNECT_MESSAGE = 'browserbase-disconnected';

export function BrowserSessionOverlay({ id, params, open, onClose }: OverlayComponentProps) {
  const sessionId = id;
  const fixtureState =
    process.env.NODE_ENV !== 'production' && id === 'fixture' ? params.get('state') : null;
  const fixture = fixtureState !== null;
  const [state, dispatch] = useReducer(reduceBrowserPanel, INITIAL_BROWSER_PANEL_STATE);
  const controlBusy = state.kind === 'live' && state.controlRequest === 'pending';
  const controlAttempt = useRef<AbortController | null>(null);
  const loadAttempt = useRef<AbortController | null>(null);
  const [loadGeneration, setLoadGeneration] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (fixture) {
        if (fixtureState === 'loading') {
          dispatch({ type: 'load' });
          return 'loading' as const;
        }
        if (fixtureState === 'error') {
          dispatch({ type: 'error' });
          return 'error' as const;
        }
        const view: BrowserPanelView =
          fixtureState === 'ended'
            ? {
                status: 'ended',
                browserbaseSessionId: 'fixture-browser-session',
                replayUrl: '#',
                url: 'https://store.example.test/orders',
                title: 'Orders · Example Store',
              }
            : {
                status: 'live',
                browserbaseSessionId: 'fixture-browser-session',
                debuggerFullscreenUrl: 'about:blank',
                url: 'https://store.example.test/orders',
                title: 'Orders · Example Store',
                browserStatus: fixtureState === 'control' ? 'user' : 'active',
              };
        dispatch({ type: 'loaded', view });
        return view.status;
      }
      if (!sessionId) {
        dispatch({ type: 'error' });
        return 'error' as const;
      }
      try {
        const view = await fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/browser`, {
          signal,
        }).then((body) => browserPanelViewSchema.parse(body));
        if (signal.aborted) return 'cancelled' as const;
        dispatch({ type: 'loaded', view });
        return view.status;
      } catch (cause) {
        if (signal.aborted) return 'cancelled' as const;
        captureException(cause, { feature: 'tooling', op: 'browser-panel-load', sessionId });
        dispatch({ type: 'poll_failed' });
        return 'retry' as const;
      }
    },
    [fixture, fixtureState, sessionId],
  );

  // browse_open opens the panel before the session row is claimed, so a
  // 'none' answer is polled (bounded) rather than shown as an error.
  useEffect(() => {
    const controller = new AbortController();
    loadAttempt.current = controller;
    let timer: number | undefined;
    let attempts = 0;
    const poll = async () => {
      const status = await load(controller.signal);
      if (
        controller.signal.aborted ||
        (status !== 'none' && status !== 'live' && status !== 'retry')
      )
        return;
      const next = nextBrowserPanelPoll(status, attempts);
      attempts = next.attempts;
      if (next.delay === null) {
        dispatch({ type: 'error' });
        return;
      }
      timer = window.setTimeout(poll, next.delay);
    };
    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [load, loadGeneration]);

  useEffect(() => {
    if (!sessionId || state.kind !== 'live') return;
    const replayUrl = `/api/sessions/${encodeURIComponent(sessionId)}/replays?bb=${encodeURIComponent(state.browserbaseSessionId)}`;
    const debuggerOrigin = new URL(state.debuggerFullscreenUrl).origin;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.origin !== debuggerOrigin) return;
      if (event.data !== DISCONNECT_MESSAGE) return;
      dispatch({ type: 'disconnected', replayUrl });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sessionId, state]);

  const setControlledByUser = async (controlledByUser: boolean) => {
    if (!sessionId || controlBusy) return;
    if (fixture) {
      dispatch({ type: controlledByUser ? 'take_control' : 'hand_back' });
      return;
    }
    loadAttempt.current?.abort();
    const attempt = new AbortController();
    controlAttempt.current = attempt;
    dispatch({ type: 'control_started' });
    try {
      await fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/browser`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ controlledByUser }),
        signal: attempt.signal,
      }).then((body) => z.object({ ok: z.literal(true) }).parse(body));
      if (attempt.signal.aborted) return;
      dispatch({ type: controlledByUser ? 'take_control' : 'hand_back' });
    } catch (cause) {
      if (attempt.signal.aborted) return;
      captureException(cause, { feature: 'tooling', op: 'browser-control', sessionId });
      toast.error('Couldn’t change browser control. Try again.');
    } finally {
      if (!attempt.signal.aborted) {
        dispatch({ type: 'control_finished' });
        setLoadGeneration((generation) => generation + 1);
      }
    }
  };

  const renewControl = state.kind === 'live' && state.browserStatus === 'user';
  useEffect(() => {
    if (!sessionId || !open || fixture || !renewControl) return;
    const lease = new AbortController();
    const timer = window.setInterval(() => {
      void fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/browser`, {
        method: 'PATCH',
        signal: lease.signal,
      }).catch((cause: unknown) => {
        if (lease.signal.aborted) return;
        dispatch({ type: 'poll_failed' });
        captureException(cause, { feature: 'tooling', op: 'browser-control-renew' });
      });
    }, 10_000);
    return () => {
      window.clearInterval(timer);
      lease.abort();
    };
  }, [sessionId, open, fixture, renewControl]);

  const title = state.kind === 'live' || state.kind === 'ended' ? state.title : null;

  return (
    <PreviewSurface
      kind="browser-session"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title || 'Live browser'}
      actions={
        <>
          <span className="mr-auto min-w-0 text-meta text-muted-foreground">
            <PanelMeta state={state} />
          </span>
          {state.kind === 'live' ? (
            <Button
              type="button"
              size="sm"
              variant={state.browserStatus === 'user' ? 'secondary' : 'primary'}
              disabled={controlBusy || state.browserStatus === 'closing'}
              onClick={() => void setControlledByUser(state.browserStatus !== 'user')}
            >
              {state.browserStatus === 'user' ? (
                <IconHand aria-hidden className="size-3.5" />
              ) : (
                <IconCursorClick01 aria-hidden className="size-3.5" />
              )}
              {state.browserStatus === 'user' ? 'Hand back' : 'Take control'}
            </Button>
          ) : null}
        </>
      }
    >
      <BrowserPanelBody
        sessionId={sessionId}
        state={state}
        iframeRef={iframeRef}
        fixture={fixture}
        onRetry={() => {
          dispatch({ type: 'load' });
          setLoadGeneration((generation) => generation + 1);
        }}
      />
    </PreviewSurface>
  );
}

// The header's second line: a status dot + word, then the page address. The
// address truncates on its own so the status never scrolls out of view.
