import type { OverlayHash } from './tokens';

export type OverlayHistoryState =
  | { kind: 'cold' | 'open' }
  | { kind: 'closing'; queued: OverlayHash | null };
export type OverlayHistoryEvent =
  | { type: 'opened' | 'cleared' | 'close' }
  | { type: 'queue'; hash: OverlayHash }
  | { type: 'traversed'; overlay: boolean };
export function overlayHistoryReducer(
  state: OverlayHistoryState,
  event: OverlayHistoryEvent,
): OverlayHistoryState {
  switch (event.type) {
    case 'opened':
      return { kind: 'open' };
    case 'cleared':
      return { kind: 'cold' };
    case 'close':
      return state.kind === 'open' ? { kind: 'closing', queued: null } : state;
    case 'queue':
      return state.kind === 'closing' ? { ...state, queued: event.hash } : state;
    case 'traversed':
      return { kind: event.overlay ? 'open' : 'cold' };
  }
}
