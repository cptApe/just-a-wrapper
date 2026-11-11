export type InvitationResponseState =
  | { kind: 'idle' }
  | { kind: 'submitting'; decision: 'accepted' | 'rejected'; attempt: symbol }
  | { kind: 'accepted' | 'rejected' };
type Event =
  | { type: 'submit'; decision: 'accepted' | 'rejected'; attempt: symbol }
  | { type: 'success' | 'failure'; attempt: symbol };
export function invitationResponseReducer(
  state: InvitationResponseState,
  event: Event,
): InvitationResponseState {
  if (event.type === 'submit')
    return state.kind === 'idle'
      ? { kind: 'submitting', decision: event.decision, attempt: event.attempt }
      : state;
  if (state.kind !== 'submitting' || event.attempt !== state.attempt) return state;
  return event.type === 'failure' ? { kind: 'idle' } : { kind: state.decision };
}
