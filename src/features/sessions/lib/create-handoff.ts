import type { OptimisticComposerAttachment } from './build-composer-message';

type HandoffMessage = {
  localId: string;
  midRun: boolean;
  text: string;
  at: string;
  attachments?: OptimisticComposerAttachment[];
};
type CreateHandoff = HandoffMessage & { queued: HandoffMessage[] };
const handoffs = new Map<string, CreateHandoff>();
const listeners = new Map<string, Set<() => void>>();

export function setCreateHandoff(
  sessionId: string,
  entry: {
    localId: string;
    text: string;
    at: string;
    attachments?: OptimisticComposerAttachment[];
  },
): void {
  appendCreateHandoff(sessionId, {
    ...entry,
    midRun: false,
  });
}

export function appendCreateHandoff(sessionId: string, entry: HandoffMessage): void {
  const current = handoffs.get(sessionId);
  if (current && [current, ...current.queued].some((message) => message.localId === entry.localId))
    return;
  handoffs.set(
    sessionId,
    current ? { ...current, queued: [...current.queued, entry] } : { ...entry, queued: [] },
  );
  for (const listener of listeners.get(sessionId) ?? []) listener();
}

export function peekCreateHandoff(sessionId: string): CreateHandoff | null {
  return handoffs.get(sessionId) ?? null;
}

export function clearCreateHandoff(sessionId: string): void {
  handoffs.delete(sessionId);
}

export function subscribeCreateHandoff(sessionId: string, listener: () => void): () => void {
  const subscribers = listeners.get(sessionId) ?? new Set<() => void>();
  subscribers.add(listener);
  listeners.set(sessionId, subscribers);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(sessionId);
  };
}
