export type ServerStreamState = { phase: 'polling' | 'closing' | 'closed' };
export function reduceServerStream(
  state: ServerStreamState,
  action: 'finish' | 'cancel' | 'close',
): ServerStreamState {
  if (state.phase === 'closed') return state;
  switch (action) {
    case 'finish':
      return { phase: 'closing' };
    case 'cancel':
      return { phase: 'closed' };
    case 'close':
      return state.phase === 'closing' ? { phase: 'closed' } : state;
  }
}
