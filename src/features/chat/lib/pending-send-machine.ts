import { defineStateMachine } from '@/lib/state-machine';
import type { LocalSend } from './reconcile-pending';

const machine = defineStateMachine('local send', {
  sending: ['unconfirmed', 'delivered', 'error'],
  unconfirmed: ['delivered', 'error'],
  error: ['sending', 'delivered'],
  delivered: [],
});
export type PendingSendAction =
  | { type: 'add'; send: LocalSend }
  | { type: 'prepared'; localId: string; text: string }
  | { type: 'delivered'; localId: string; eventId: string | null; processedAt: string | null }
  | { type: 'unconfirmed'; localId: string }
  | { type: 'replay_settled' }
  | { type: 'failed'; localId: string; message: string | undefined }
  | { type: 'retry'; localId: string; midRun: boolean; statusAtSend?: number }
  | { type: 'remove'; localId: string }
  | { type: 'reconcile'; echoedLocalIds: ReadonlySet<string>; statusAt?: number };

// A refused move returns the same array, so the reducer store skips its listeners.
function unlessUnchanged(state: LocalSend[], next: LocalSend[]): LocalSend[] {
  return next.length === state.length && next.every((send, index) => send === state[index])
    ? state
    : next;
}

export function pendingSendReducer(state: LocalSend[], action: PendingSendAction): LocalSend[] {
  if (action.type === 'add')
    return state.some((send) => send.localId === action.send.localId)
      ? state
      : [...state, action.send];
  if (action.type === 'remove')
    return unlessUnchanged(
      state,
      state.filter((send) => send.localId !== action.localId),
    );
  if (action.type === 'reconcile') {
    const next = state.flatMap((send): LocalSend[] => {
      if (!action.echoedLocalIds.has(send.localId)) return [send];
      if (
        send.statusAtSend === undefined ||
        (action.statusAt !== undefined && action.statusAt > send.statusAtSend)
      ) {
        return [];
      }
      if (!machine.can(send.status, 'delivered')) return [send];
      return [{ ...send, status: 'delivered', errorMessage: undefined }];
    });
    return unlessUnchanged(state, next);
  }
  if (action.type === 'replay_settled')
    return unlessUnchanged(
      state,
      state.map(
        (send): LocalSend =>
          send.status === 'unconfirmed'
            ? {
                ...send,
                status: 'error',
                errorMessage: 'Delivery could not be confirmed. Retry to check again.',
              }
            : send,
      ),
    );
  const next = state.map((send): LocalSend => {
    if (send.localId !== action.localId) return send;
    switch (action.type) {
      case 'prepared':
        return send.status === 'sending' ? { ...send, text: action.text } : send;
      case 'delivered':
        return machine.can(send.status, 'delivered')
          ? {
              ...send,
              status: 'delivered',
              errorMessage: undefined,
              serverEventId: action.eventId ?? undefined,
              serverProcessedAt: action.processedAt ?? undefined,
            }
          : send;
      case 'unconfirmed':
        return machine.can(send.status, 'unconfirmed')
          ? {
              ...send,
              status: 'unconfirmed',
              errorMessage: undefined,
              serverEventId: undefined,
              serverProcessedAt: undefined,
            }
          : send;
      case 'failed':
        return machine.can(send.status, 'error')
          ? {
              ...send,
              status: 'error',
              errorMessage: action.message,
              serverEventId: undefined,
              serverProcessedAt: undefined,
            }
          : send;
      case 'retry':
        return machine.can(send.status, 'sending')
          ? {
              ...send,
              status: 'sending',
              errorMessage: undefined,
              serverEventId: undefined,
              serverProcessedAt: undefined,
              midRun: action.midRun,
              statusAtSend: action.statusAtSend,
            }
          : send;
    }
  });
  return unlessUnchanged(state, next);
}
