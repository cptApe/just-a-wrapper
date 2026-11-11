import type { AttachCanvasMode } from '../components/composer-attach-canvas';

export type ComposerCanvasState = {
  kind: 'closed' | 'open';
  mode: AttachCanvasMode;
  nonce: number;
};
type CanvasEvent = { type: 'open'; mode: AttachCanvasMode } | { type: 'close' };

export function reduceComposerCanvas(
  state: ComposerCanvasState,
  event: CanvasEvent,
): ComposerCanvasState {
  switch (event.type) {
    case 'open':
      return { kind: 'open', mode: event.mode, nonce: state.nonce + 1 };
    case 'close':
      return state.kind === 'closed' ? state : { ...state, kind: 'closed' };
  }
}
