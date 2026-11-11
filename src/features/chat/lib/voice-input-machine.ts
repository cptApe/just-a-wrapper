export type VoiceState =
  | { kind: 'idle' }
  | { kind: 'requesting' | 'recording' | 'transcribing'; attempt: symbol };

type VoiceEvent =
  | { type: 'start'; attempt: symbol }
  | { type: 'record' | 'confirm' | 'finish'; attempt: symbol }
  | { type: 'cancel' };

export function reduceVoiceInput(state: VoiceState, event: VoiceEvent): VoiceState {
  if (event.type === 'cancel') return state.kind === 'idle' ? state : { kind: 'idle' };
  if (event.type === 'start') {
    return state.kind === 'idle' ? { kind: 'requesting', attempt: event.attempt } : state;
  }
  if (state.kind === 'idle' || state.attempt !== event.attempt) return state;
  switch (event.type) {
    case 'record':
      return state.kind === 'requesting' ? { kind: 'recording', attempt: event.attempt } : state;
    case 'confirm':
      return state.kind === 'recording' ? { kind: 'transcribing', attempt: event.attempt } : state;
    case 'finish':
      return { kind: 'idle' };
  }
}
