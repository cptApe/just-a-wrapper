type Draft = { draft: string; baseContentSha256: string };
export type DraftState =
  | { kind: 'read' | 'waiting' }
  | ({ kind: 'editing' | 'conflict' } & Draft)
  | ({ kind: 'saving' | 'reloading'; attempt: string } & Draft);
export type DraftEvent =
  | { type: 'edit'; draft: string; baseContentSha256: string }
  | { type: 'change'; draft: string }
  | { type: 'cancel' }
  | { type: 'save' | 'reload'; attempt: string }
  | { type: 'saved' | 'failed' | 'conflict' | 'reloaded' | 'reloadFailed'; attempt: string };
export function reduceDraft(state: DraftState, event: DraftEvent): DraftState {
  switch (event.type) {
    case 'edit':
      return state.kind === 'read' || state.kind === 'waiting' || state.kind === 'editing'
        ? { kind: 'editing', draft: event.draft, baseContentSha256: event.baseContentSha256 }
        : state;
    case 'change':
      return state.kind === 'editing' || state.kind === 'conflict'
        ? { ...state, draft: event.draft }
        : state;
    case 'cancel':
      return state.kind === 'editing' || state.kind === 'conflict' ? { kind: 'read' } : state;
    case 'save':
      return state.kind === 'editing'
        ? { ...state, kind: 'saving', attempt: event.attempt }
        : state;
    case 'reload':
      return state.kind === 'conflict'
        ? { ...state, kind: 'reloading', attempt: event.attempt }
        : state;
    default:
      if (!('attempt' in state) || state.attempt !== event.attempt) return state;
      if (state.kind === 'saving') {
        if (event.type === 'saved') return { kind: 'read' };
        if (event.type === 'failed' || event.type === 'conflict')
          return {
            kind: event.type === 'failed' ? 'editing' : 'conflict',
            draft: state.draft,
            baseContentSha256: state.baseContentSha256,
          };
      }
      if (state.kind === 'reloading') {
        if (event.type === 'reloaded') return { kind: 'read' };
        if (event.type === 'reloadFailed')
          return {
            kind: 'conflict',
            draft: state.draft,
            baseContentSha256: state.baseContentSha256,
          };
      }
      return state;
  }
}
