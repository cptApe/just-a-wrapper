export type ComposerSubmitState =
  | { kind: 'idle' }
  | { kind: 'armed' }
  | { kind: 'submitting'; attempt: symbol };

type SubmitEvent =
  | { type: 'emptied' }
  | { type: 'request'; canSubmit: boolean; gate: 'ready' | 'uploading' | 'failed'; attempt: symbol }
  | { type: 'ready'; canSubmit: boolean; attempt: symbol }
  | { type: 'settled'; attempt: symbol };

export function reduceComposerSubmit(
  state: ComposerSubmitState,
  event: SubmitEvent,
): ComposerSubmitState {
  switch (event.type) {
    case 'emptied':
      return state.kind === 'armed' ? { kind: 'idle' } : state;
    case 'request':
      if (state.kind === 'armed') return { kind: 'idle' };
      if (state.kind !== 'idle' || !event.canSubmit) return state;
      return event.gate === 'ready'
        ? { kind: 'submitting', attempt: event.attempt }
        : { kind: 'armed' };
    case 'ready':
      return state.kind === 'armed' && event.canSubmit
        ? { kind: 'submitting', attempt: event.attempt }
        : state;
    case 'settled':
      return state.kind === 'submitting' && state.attempt === event.attempt
        ? { kind: 'idle' }
        : state;
  }
}
