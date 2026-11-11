export type OverlayRetentionState<Value> =
  | { kind: 'closed' }
  | { kind: 'open' | 'closing'; value: Value };
export type OverlayRetentionEvent<Value> =
  | { type: 'open'; value: Value }
  | { type: 'close' }
  | { type: 'release'; value: Value };
export function overlayRetentionReducer<Value>(
  state: OverlayRetentionState<Value>,
  event: OverlayRetentionEvent<Value>,
): OverlayRetentionState<Value> {
  switch (event.type) {
    case 'open':
      return { kind: 'open', value: event.value };
    case 'close':
      return state.kind === 'open' ? { kind: 'closing', value: state.value } : state;
    case 'release':
      return state.kind === 'closing' && state.value === event.value ? { kind: 'closed' } : state;
  }
}
