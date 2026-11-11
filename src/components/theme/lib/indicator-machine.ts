export type IndicatorState =
  | { kind: 'unmounted'; index: number }
  | { kind: 'ready'; index: number; from: number };
export function indicatorReducer(state: IndicatorState, event: { index: number }): IndicatorState {
  if (state.kind === 'unmounted') return { kind: 'ready', index: event.index, from: event.index };
  return state.index === event.index
    ? state
    : { kind: 'ready', index: event.index, from: state.index };
}
