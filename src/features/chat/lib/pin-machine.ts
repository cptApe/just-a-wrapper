type PinPhase = { kind: 'idle' } | { kind: 'pending' } | { kind: 'turn'; key: string };
export type PinState = { phase: PinPhase; pendingCount: number; localTurn: string | null };
export type PinAction =
  | { type: 'collapse' }
  | {
      type: 'observe';
      pendingCount: number;
      localTurn: string | null;
      turn: string | null;
      shouldPin: boolean;
    };
export function pinReducer(state: PinState, action: PinAction): PinState {
  if (action.type === 'collapse')
    return state.phase.kind === 'idle' ? state : { ...state, phase: { kind: 'idle' } };
  if (state.pendingCount === action.pendingCount && state.localTurn === action.localTurn)
    return state;
  let phase = state.phase;
  if (action.pendingCount > state.pendingCount)
    phase = action.shouldPin ? { kind: 'pending' } : { kind: 'idle' };
  if (
    action.pendingCount === 0 &&
    action.turn &&
    (phase.kind === 'pending' ||
      (action.shouldPin && action.localTurn !== null && action.localTurn !== state.localTurn))
  )
    phase = { kind: 'turn', key: action.turn };
  return { phase, pendingCount: action.pendingCount, localTurn: action.localTurn };
}
