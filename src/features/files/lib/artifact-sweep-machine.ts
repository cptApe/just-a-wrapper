export type ArtifactSweepState = {
  seen: ReadonlySet<string>;
  stableRounds: number;
  inserted: number;
} & ({ kind: 'empty' } | { kind: 'observing' } | { kind: 'settled' });
export const initialArtifactSweep: ArtifactSweepState = {
  kind: 'empty',
  seen: new Set(),
  stableRounds: 0,
  inserted: 0,
};
export function artifactSweepReducer(
  state: ArtifactSweepState,
  event: { ids: string[]; inserted: number },
): ArtifactSweepState {
  if (state.kind === 'settled') return state;
  const seen = new Set([...state.seen, ...event.ids]);
  const stableRounds = seen.size === state.seen.size ? state.stableRounds + 1 : 0;
  return {
    kind: seen.size === 0 ? 'empty' : stableRounds >= 2 ? 'settled' : 'observing',
    seen,
    stableRounds,
    inserted: state.inserted + event.inserted,
  };
}
