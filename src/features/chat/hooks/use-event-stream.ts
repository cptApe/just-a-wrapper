'use client';
import { useCallback, useEffect, useReducer } from 'react';
import type { ChatEvent } from '@/features/sessions';
import { createInitialState } from '../lib/chat-state';
import { chatReducer } from '../lib/chat-stream-reducer';
import { connectionReducer, initialConnection } from '../lib/connection-machine';
import { isStreamQuietStale } from '../lib/stream-staleness';
import { useMachineStore } from './use-machine-store';
import { useRelayConnection } from './use-relay-connection';

export type EventStream = ReturnType<typeof useEventStream>;

export function useEventStream(sessionId: string) {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);
  const connectionStore = useMachineStore(initialConnection(0), connectionReducer);
  const connection = connectionStore.state;
  const send = connectionStore.dispatch;
  const remint = useCallback(() => send({ type: 'remint', now: Date.now() }), [send]);
  const foldEvent = useCallback((event: ChatEvent) => dispatch({ type: 'event', event }), []);
  const isQuietStale = useCallback(
    () => connection.status !== 'error' && isStreamQuietStale(connection.lastFrameAt, Date.now()),
    [connection.status, connection.lastFrameAt],
  );
  useEffect(() => {
    if (
      connection.status === 'error' ||
      connection.status === 'done' ||
      connection.status === 'access_lost'
    )
      return;
    const timer = setInterval(
      () => send({ type: 'tick', now: Date.now(), running: state.status === 'running' }),
      1000,
    );
    return () => clearInterval(timer);
  }, [state.status, connection.status, send]);
  useRelayConnection({ sessionId, connection, connectionStore, send, dispatch });
  const meta = {
    traceId: connection.traceId,
    lastSeenEventId: connection.lastSeenEventId,
    error: connection.error,
  };
  return {
    state,
    status: connection.status,
    meta,
    remint,
    foldEvent,
    isQuietStale,
    replaySettled: connection.replay.kind === 'settled',
  };
}
