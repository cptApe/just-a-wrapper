export type MemberMutationState =
  | { kind: 'idle' }
  | { kind: 'pending'; memberId: string; attempt: symbol };
export type MemberMutationEvent =
  | { type: 'start'; memberId: string; attempt: symbol }
  | { type: 'finish'; attempt: symbol };
export function memberMutationReducer(
  state: MemberMutationState,
  event: MemberMutationEvent,
): MemberMutationState {
  if (event.type === 'start')
    return state.kind === 'idle'
      ? { kind: 'pending', memberId: event.memberId, attempt: event.attempt }
      : state;
  return state.kind === 'pending' && state.attempt === event.attempt ? { kind: 'idle' } : state;
}
