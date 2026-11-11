import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { captureException } from '@/lib/observability-client';
import { sessionQueryKeys } from '../api/keys';
import { applySessionChatEvent } from '../api/session-live-cache';
import type { ChatEvent } from '../types';
import { type BackgroundStreamState, reduceBackgroundStream } from './background-stream-machine';
import { parseSessionStatusFrame } from './parse-session-status-frame';

const doneSchema = z.object({ reason: z.enum(['terminal', 'closed']) });
export type BackgroundSessionStream = { close(): void };
export function openBackgroundSessionStream(
  queryClient: QueryClient,
  id: string,
): BackgroundSessionStream {
  let source: EventSource;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let state: BackgroundStreamState = { phase: 'replaying', latest: null };
  const apply = (event: ChatEvent, replay: boolean) =>
    applySessionChatEvent(
      queryClient,
      id,
      event,
      window.location.pathname === `/app/task/${id}`,
      replay,
    );
  function reconnect() {
    if (state.phase === 'closed') return;
    source.close();
    state = reduceBackgroundStream(state, { type: 'reconnect' });
    clearTimeout(timer);
    timer = setTimeout(connect, 2000);
  }
  function close() {
    state = reduceBackgroundStream(state, { type: 'close' });
    clearTimeout(timer);
    source.close();
  }
  function connect() {
    if (state.phase === 'closed') return;
    state = reduceBackgroundStream(state, { type: 'connect' });
    const connection = new EventSource(`/api/sessions/${id}/stream`);
    source = connection;
    connection.addEventListener('open', () => {
      if (source === connection) state = reduceBackgroundStream(state, { type: 'connect' });
    });
    connection.addEventListener('event', (message) => {
      if (source !== connection || state.phase === 'closed') return;
      try {
        const event = parseSessionStatusFrame(JSON.parse(message.data));
        if (!event) return;
        if (state.phase === 'live') apply(event, false);
        state = reduceBackgroundStream(state, { type: 'event', event });
      } catch (error) {
        captureException(error, { op: 'sidebar.sse.decode', sessionId: id });
      }
    });
    connection.addEventListener('history', () => {
      if (source !== connection || state.phase === 'closed') return;
      if (state.phase === 'replaying' && state.latest) apply(state.latest, true);
      state = reduceBackgroundStream(state, { type: 'history' });
    });
    connection.addEventListener('done', (message) => {
      if (source !== connection || state.phase === 'closed') return;
      try {
        const done = doneSchema.parse(JSON.parse(message.data));
        if (done.reason === 'terminal') close();
        else reconnect();
        void queryClient.invalidateQueries({ queryKey: sessionQueryKeys.root });
      } catch (error) {
        captureException(error, { op: 'sidebar.sse.done', sessionId: id });
      }
    });
    connection.onerror = () => {
      if (source !== connection || state.phase === 'closed') return;
      if (connection.readyState === EventSource.CLOSED) reconnect();
      else state = reduceBackgroundStream(state, { type: 'reconnect' });
    };
  }
  connect();
  return { close };
}
