export type AsyncActionState = { kind: 'idle' } | { kind: 'pending'; attempt: symbol };
export type AsyncActionEvent = { type: 'start' | 'finish'; attempt: symbol };
export function asyncActionReducer(
  state: AsyncActionState,
  event: AsyncActionEvent,
): AsyncActionState {
  if (event.type === 'start')
    return state.kind === 'idle' ? { kind: 'pending', attempt: event.attempt } : state;
  return state.kind === 'pending' && state.attempt === event.attempt ? { kind: 'idle' } : state;
}
