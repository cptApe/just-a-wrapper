export type RenameState = { kind: 'editing' } | { kind: 'committed' } | { kind: 'cancelled' };
export function renameReducer(state: RenameState, event: 'commit' | 'cancel'): RenameState {
  return state.kind === 'editing'
    ? { kind: event === 'commit' ? 'committed' : 'cancelled' }
    : state;
}
