export type ReadAloudState = { kind: 'idle' } | { kind: 'loading' | 'playing'; attempt: symbol };
export type ReadAloudAction =
  | { type: 'start'; attempt: symbol }
  | { type: 'playing'; attempt: symbol }
  | { type: 'stop' };
export function readAloudReducer(state: ReadAloudState, action: ReadAloudAction): ReadAloudState {
  switch (action.type) {
    case 'start':
      return state.kind === 'idle' ? { kind: 'loading', attempt: action.attempt } : state;
    case 'playing':
      return state.kind === 'loading' && state.attempt === action.attempt
        ? { kind: 'playing', attempt: action.attempt }
        : state;
    case 'stop':
      return { kind: 'idle' };
  }
}
