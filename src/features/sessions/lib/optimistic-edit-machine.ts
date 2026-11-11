export type OptimisticEditState = { phase: 'applied' | 'superseded' | 'released' | 'rolled_back' };
export function reduceOptimisticEdit(
  state: OptimisticEditState,
  action: 'supersede' | 'release' | 'rollback',
): OptimisticEditState {
  if (state.phase !== 'applied') return state;
  switch (action) {
    case 'supersede':
      return { phase: 'superseded' };
    case 'release':
      return { phase: 'released' };
    case 'rollback':
      return { phase: 'rolled_back' };
  }
}
