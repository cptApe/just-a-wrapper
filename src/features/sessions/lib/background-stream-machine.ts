import type { ChatEvent } from '../types';

export type BackgroundStreamState =
  | { phase: 'replaying'; latest: ChatEvent | null }
  | { phase: 'live' }
  | { phase: 'closed' }
  | { phase: 'reconnecting' };
export type BackgroundStreamAction =
  | { type: 'reconnect' }
  | { type: 'connect' }
  | { type: 'event'; event: ChatEvent }
  | { type: 'history' }
  | { type: 'close' };
export function reduceBackgroundStream(
  state: BackgroundStreamState,
  action: BackgroundStreamAction,
): BackgroundStreamState {
  if (state.phase === 'closed') return state;
  switch (action.type) {
    case 'reconnect':
      return { phase: 'reconnecting' };
    case 'connect':
      return { phase: 'replaying', latest: null };
    case 'event':
      return state.phase === 'replaying' ? { ...state, latest: action.event } : state;
    case 'history':
      return state.phase === 'replaying' ? { phase: 'live' } : state;
    case 'close':
      return { phase: 'closed' };
  }
}
