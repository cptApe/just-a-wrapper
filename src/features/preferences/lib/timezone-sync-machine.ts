export type TimezoneSyncState = { kind: 'idle' | 'saved' } | { kind: 'saving'; attempt: symbol };
export type TimezoneSyncEvent = { type: 'start' | 'saved' | 'failed'; attempt: symbol };
export function timezoneSyncReducer(
  state: TimezoneSyncState,
  event: TimezoneSyncEvent,
): TimezoneSyncState {
  if (event.type === 'start')
    return state.kind === 'idle' ? { kind: 'saving', attempt: event.attempt } : state;
  if (state.kind !== 'saving' || state.attempt !== event.attempt) return state;
  return { kind: event.type === 'saved' ? 'saved' : 'idle' };
}
