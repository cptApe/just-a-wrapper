'use client';
import { captureException } from '@/lib/observability-client';
import { publishedEventSchema } from '@/lib/workspace-event';
import type { PublishedWorkspaceEvent } from './channel';
import { reduceStream, type StreamState } from './stream-machine';

let source: EventSource | null = null;
let state: StreamState = { phase: 'disconnected' };
let attempt = 0;
const eventListeners = new Map<(event: PublishedWorkspaceEvent) => void, string>();
// Multiple hooks share one tab connection; a closed connection cannot deliver to a new workspace.
function connect(identity: string) {
  source?.close();
  const token = ++attempt;
  state = reduceStream(state, { type: 'connect', identity, attempt: token });
  const parameters = new URLSearchParams();
  if (state.phase !== 'disconnected' && state.cursor) parameters.set('last_event_id', state.cursor);
  const connection = new EventSource(`/api/realtime/stream?${parameters}`);
  source = connection;
  connection.addEventListener('cursor', (message: MessageEvent<string>) => {
    if (source !== connection) return;
    const reset =
      state.phase !== 'disconnected' && state.cursor !== '' && state.cursor !== message.lastEventId;
    state = reduceStream(state, { type: 'cursor', attempt: token, cursor: message.lastEventId });
    if (reset)
      for (const [listener, subscriberIdentity] of eventListeners) {
        if (subscriberIdentity === identity) listener({ type: 'resync', publishedAt: Date.now() });
      }
  });
  connection.onerror = () => {
    if (source === connection) state = reduceStream(state, { type: 'error', attempt: token });
  };
  connection.onmessage = (message: MessageEvent<string>) => {
    if (source !== connection) return;
    if (message.lastEventId)
      state = reduceStream(state, { type: 'event', attempt: token, cursor: message.lastEventId });
    try {
      const event = publishedEventSchema.parse(JSON.parse(message.data));
      for (const [listener, subscriberIdentity] of eventListeners) {
        if (subscriberIdentity === identity) listener(event);
      }
    } catch (error) {
      captureException(error, { op: 'realtime-event' });
    }
  };
}
export function retainStream(
  organizationId: string,
  userId: string,
  listener: (event: PublishedWorkspaceEvent) => void,
) {
  const nextIdentity = `${organizationId}:${userId}`;
  if (state.phase === 'disconnected' || state.identity !== nextIdentity) {
    source?.close();
    source = null;
  }
  eventListeners.set(listener, nextIdentity);
  if (!source) connect(nextIdentity);
  return () => {
    eventListeners.delete(listener);
    if (eventListeners.size === 0) {
      source?.close();
      source = null;
      state = reduceStream(state, { type: 'disconnect' });
    }
  };
}
