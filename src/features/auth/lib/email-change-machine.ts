export type EmailDraftState =
  | { kind: 'editing'; value: string }
  | { kind: 'invalid'; value: string; message: string };
export type EmailDraftEvent =
  | { type: 'edit'; value: string }
  | { type: 'invalid'; message: string }
  | { type: 'reset' };
export function emailDraftReducer(state: EmailDraftState, event: EmailDraftEvent): EmailDraftState {
  switch (event.type) {
    case 'reset':
      return { kind: 'editing', value: '' };
    case 'edit':
      return { kind: 'editing', value: event.value };
    case 'invalid':
      return { kind: 'invalid', value: state.value, message: event.message };
  }
}
