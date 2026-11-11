export type PaceState = {
  kind: 'caught-up' | 'releasing';
  target: string;
  shown: string;
  lastRelease: number;
  interval: number;
};
export type PaceAction = { type: 'target'; text: string } | { type: 'tick'; now: number };
export function initialPace(target: string): PaceState {
  return {
    kind: target ? 'releasing' : 'caught-up',
    target,
    shown: '',
    lastRelease: 0,
    interval: 35,
  };
}
export function paceReducer(state: PaceState, action: PaceAction): PaceState {
  if (action.type === 'target') {
    if (action.text === state.target) return state;
    const shown = action.text.startsWith(state.shown) ? state.shown : '';
    return {
      ...state,
      kind: shown === action.text ? 'caught-up' : 'releasing',
      target: action.text,
      shown,
    };
  }
  if (state.kind === 'caught-up') return state;
  const buffered = state.target.length - state.shown.length;
  const interval = state.interval + (35 - Math.min(buffered / 300, 1) * 20 - state.interval) * 0.12;
  if (action.now - state.lastRelease < interval) return state;
  const remaining = state.target.slice(state.shown.length);
  let release = '';
  for (let index = 0; index < Math.max(1, Math.floor(buffered / 300) + 1); index++) {
    const match = remaining.slice(release.length).match(/^\s*\S+/);
    if (!match) {
      release = remaining;
      break;
    }
    release += match[0];
  }
  const shown = state.shown + release;
  return {
    ...state,
    kind: shown === state.target ? 'caught-up' : 'releasing',
    shown,
    interval,
    lastRelease: action.now,
  };
}
