export type MemberLimitState = { value: string; saved: string } & (
  | { kind: 'idle' | 'validation_error' }
  | { kind: 'saving'; attempt: string }
);
export type MemberLimitEvent =
  | { type: 'edit'; value: string }
  | { type: 'invalid' }
  | { type: 'save'; attempt: string }
  | { type: 'saved' | 'failed'; attempt: string };
export function memberLimitReducer(
  state: MemberLimitState,
  event: MemberLimitEvent,
): MemberLimitState {
  if (event.type === 'edit')
    return state.kind === 'saving'
      ? state
      : { kind: 'idle', saved: state.saved, value: event.value };
  if (event.type === 'invalid')
    return state.kind === 'saving' ? state : { ...state, kind: 'validation_error' };
  if (event.type === 'save')
    return state.kind === 'saving' ? state : { ...state, kind: 'saving', attempt: event.attempt };
  if (state.kind !== 'saving' || state.attempt !== event.attempt) return state;
  return {
    kind: 'idle',
    value: state.value,
    saved: event.type === 'saved' ? state.value : state.saved,
  };
}
