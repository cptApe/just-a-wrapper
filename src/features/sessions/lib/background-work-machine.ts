export type BackgroundWorkState = { phase: 'open' | 'draining' | 'settled' };
export function reduceBackgroundWork(
  state: BackgroundWorkState,
  action: 'close' | 'enqueue' | 'drain',
): BackgroundWorkState {
  switch (action) {
    case 'close':
      return state.phase === 'open' ? { phase: 'draining' } : state;
    case 'enqueue':
      return state.phase === 'settled' ? { phase: 'draining' } : state;
    case 'drain':
      return state.phase === 'draining' ? { phase: 'settled' } : state;
  }
}
