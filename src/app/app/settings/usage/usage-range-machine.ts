export type RangeState = { kind: 'closed' } | { kind: 'editing'; from: string; to: string };
export function rangeReducer(
  state: RangeState,
  event:
    | { type: 'open'; from: string; to: string }
    | { type: 'close' }
    | { type: 'from' | 'to'; value: string },
): RangeState {
  switch (event.type) {
    case 'open':
      return { kind: 'editing', from: event.from, to: event.to };
    case 'close':
      return { kind: 'closed' };
    case 'from':
      return state.kind === 'editing' ? { ...state, from: event.value } : state;
    case 'to':
      return state.kind === 'editing' ? { ...state, to: event.value } : state;
  }
}
