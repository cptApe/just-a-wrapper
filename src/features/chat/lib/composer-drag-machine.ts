export type ComposerDragState = { kind: 'inactive' } | { kind: 'active'; depth: number };
export function reduceComposerDrag(
  state: ComposerDragState,
  event: 'enter' | 'leave' | 'drop',
): ComposerDragState {
  switch (event) {
    case 'enter':
      return { kind: 'active', depth: state.kind === 'active' ? state.depth + 1 : 1 };
    case 'leave':
      if (state.kind === 'inactive') return state;
      return state.depth > 1 ? { kind: 'active', depth: state.depth - 1 } : { kind: 'inactive' };
    case 'drop':
      return state.kind === 'inactive' ? state : { kind: 'inactive' };
  }
}
