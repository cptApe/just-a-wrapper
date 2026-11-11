export type CanvasState = { kind: 'idle' | 'resizing'; width: number; dirty: boolean };
export type CanvasEvent =
  | { type: 'start' | 'finish' | 'close' | 'persisted' }
  | { type: 'width' | 'restore'; width: number };

export function canvasReducer(state: CanvasState, event: CanvasEvent): CanvasState {
  switch (event.type) {
    case 'start':
      return { ...state, kind: 'resizing' };
    case 'finish':
    case 'close':
      return state.kind === 'idle' ? state : { ...state, kind: 'idle' };
    case 'restore':
      return state.kind === 'resizing' || (state.width === event.width && !state.dirty)
        ? state
        : { ...state, width: event.width, dirty: false };
    case 'persisted':
      return { ...state, dirty: false };
    case 'width':
      return state.width === event.width ? state : { ...state, width: event.width, dirty: true };
  }
}
