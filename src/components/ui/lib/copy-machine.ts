export type CopyState = { kind: 'idle' | 'copying' | 'copied' | 'error' };
export type CopyEvent = { type: 'start' | 'reset' } | { type: 'settle'; copied: boolean };

export function copyReducer(state: CopyState, event: CopyEvent): CopyState {
  switch (event.type) {
    case 'start':
      return state.kind === 'copying' ? state : { kind: 'copying' };
    case 'settle':
      return state.kind === 'copying' ? { kind: event.copied ? 'copied' : 'error' } : state;
    case 'reset':
      return state.kind === 'copied' || state.kind === 'error' ? { kind: 'idle' } : state;
  }
}
