export type ArtifactRefreshState = {
  status: string | null;
  signal: number;
  revision: number;
  idleEpoch: number;
};
export function artifactRefreshReducer(
  state: ArtifactRefreshState,
  event: { type: 'retry' } | { type: 'observe'; status: string | null; signal: number },
): ArtifactRefreshState {
  if (event.type === 'retry') return { ...state, revision: state.revision + 1 };
  const settled = event.status === 'idle' && state.status !== null && state.status !== 'idle';
  const refresh = event.signal > state.signal || settled;
  return {
    status: event.status,
    signal: event.signal,
    revision: state.revision + (refresh ? 1 : 0),
    idleEpoch: state.idleEpoch + (settled ? 1 : 0),
  };
}
