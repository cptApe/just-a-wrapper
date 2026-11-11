export type TouchMenuState = { phase: 'normal' | 'menu' | 'suppress' };
export function reduceTouchMenu(
  state: TouchMenuState,
  action: 'context' | 'read' | 'open' | 'blur',
): TouchMenuState {
  switch (action) {
    case 'context':
      return { phase: 'menu' };
    case 'blur':
      return { phase: state.phase === 'menu' ? 'suppress' : state.phase };
    case 'read':
      return { phase: state.phase === 'menu' ? 'suppress' : 'normal' };
    case 'open':
      return { phase: 'normal' };
  }
}
