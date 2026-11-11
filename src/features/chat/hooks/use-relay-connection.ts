'use client';
import { useQueryClient } from '@tanstack/react-query';
import { type Dispatch, useEffect, useEffectEvent } from 'react';
import type { ChatEvent } from '@/features/sessions';
import { applySessionChatEvent } from '@/features/sessions/browser';
import { captureException } from '@/lib/observability-client';
import type { chatReducer } from '../lib/chat-stream-reducer';
import type { ConnectionAction, ConnectionState } from '../lib/connection-machine';
import { decodeFrame } from '../lib/decode-relay-frame';

export function useRelayConnection({
  sessionId,
  connection,
  connectionStore,
  send,
  dispatch,
}: {
  sessionId: string;
  connection: ConnectionState;
  connectionStore: { getSnapshot: () => ConnectionState };
  send: Dispatch<ConnectionAction>;
  dispatch: Dispatch<Parameters<typeof chatReducer>[1]>;
}) {
  const queryClient = useQueryClient();
  const { epoch } = connection;
  const applyStatus = (event: ChatEvent, replay: boolean) =>
    applySessionChatEvent(
      queryClient,
      sessionId,
      event,
      window.location.pathname === `/app/task/${sessionId}`,
      replay,
    );
  const receiveStatus = useEffectEvent((event: ChatEvent) => {
    if (connectionStore.getSnapshot().replay.kind === 'settled') applyStatus(event, false);
    else if (event.kind === 'status') send({ type: 'status', epoch, event });
  });
  const settleReplay = useEffectEvent(() => {
    const replay = connectionStore.getSnapshot().replay;
    if (replay.kind === 'replaying' && replay.latestStatus) applyStatus(replay.latestStatus, true);
    send({ type: 'history', epoch, now: Date.now() });
  });
  useEffect(() => {
    send({ type: 'socket_started', epoch, now: Date.now() });
    const lifetime = new AbortController();
    const source = new EventSource(`/api/sessions/${sessionId}/stream`);
    const markFrame = () => send({ type: 'frame', epoch, now: Date.now() });
    const stop = () => {
      lifetime.abort();
      source.close();
    };
    source.onopen = () => {
      if (!lifetime.signal.aborted) send({ type: 'open', epoch, now: Date.now() });
    };
    const probeAndRecover = async () => {
      send({ type: 'reconnecting', epoch, now: Date.now() });
      try {
        // eslint-disable-next-line no-restricted-syntax -- access probe uses HTTP status without a response body
        const response = await fetch(`/api/sessions/${sessionId}/stream?probe=1`, {
          signal: lifetime.signal,
        });
        if (lifetime.signal.aborted) return;
        if ([401, 403, 404].includes(response.status)) {
          send({
            type: 'error',
            epoch,
            error: { code: 'ACCESS_LOST' },
          });
          stop();
          return;
        }
      } catch (error) {
        if (lifetime.signal.aborted) return;
        captureException(error, { op: 'chat.sse.probe', sessionId });
      }
      send({ type: 'recover', epoch, now: Date.now() });
    };
    source.onerror = (event) => {
      if (lifetime.signal.aborted || event instanceof MessageEvent) return;
      if (source.readyState === EventSource.CLOSED) void probeAndRecover();
      else send({ type: 'reconnecting', epoch, now: Date.now() });
    };
    const receive = (event: MessageEvent<string>) => {
      if (lifetime.signal.aborted) return;
      const frame = decodeFrame(event.data);
      if (!frame) return;
      markFrame();
      switch (frame.type) {
        case 'event':
          receiveStatus(frame.event);
          dispatch({ type: 'event', event: frame.event });
          break;
        case 'preview_start':
          dispatch({
            type: 'preview_start',
            eventId: frame.eventId,
            previewType: frame.previewType,
          });
          break;
        case 'preview_delta':
          dispatch({
            type: 'preview_delta',
            eventId: frame.eventId,
            index: frame.index,
            text: frame.text,
          });
          break;
        case 'history':
          settleReplay();
          break;
        case 'meta':
          send({
            type: 'meta',
            epoch,
            traceId: frame.traceId,
            lastSeenEventId: frame.lastSeenEventId ?? null,
          });
          break;
        case 'heartbeat':
          break;
        case 'done':
          settleReplay();
          if (frame.reason === 'terminal') {
            send({ type: 'done', epoch, now: Date.now() });
            stop();
          }
          break;
        case 'error':
          send({ type: 'error', epoch, error: { code: frame.code } });
          stop();
          break;
      }
    };
    for (const name of [
      'event',
      'preview_start',
      'preview_delta',
      'history',
      'meta',
      'heartbeat',
      'done',
    ])
      source.addEventListener(name, receive);
    source.addEventListener('error', (event) => {
      if (event instanceof MessageEvent) receive(event);
    });
    return stop;
  }, [sessionId, epoch, send, dispatch]);
}
