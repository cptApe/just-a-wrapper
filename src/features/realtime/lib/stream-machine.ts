export type StreamState =
  | { phase: 'disconnected' }
  | { phase: 'connecting'; identity: string; cursor: string; attempt: number }
  | { phase: 'open'; identity: string; cursor: string; attempt: number };
export type StreamAction =
  | { type: 'connect'; identity: string; attempt: number }
  | { type: 'cursor'; attempt: number; cursor: string }
  | { type: 'event'; attempt: number; cursor: string }
  | { type: 'error'; attempt: number }
  | { type: 'disconnect' };
export function reduceStream(state: StreamState, action: StreamAction): StreamState {
  if (action.type === 'disconnect') return { phase: 'disconnected' };
  if (action.type === 'connect')
    return {
      phase: 'connecting',
      identity: action.identity,
      attempt: action.attempt,
      cursor:
        state.phase !== 'disconnected' && state.identity === action.identity ? state.cursor : '',
    };
  if (state.phase === 'disconnected' || state.attempt !== action.attempt) return state;
  switch (action.type) {
    case 'cursor':
      return { ...state, phase: 'open', cursor: action.cursor };
    case 'event':
      return { ...state, cursor: action.cursor };
    case 'error':
      return {
        phase: 'connecting',
        identity: state.identity,
        cursor: state.cursor,
        attempt: state.attempt,
      };
  }
}
