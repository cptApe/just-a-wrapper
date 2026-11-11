type ImageTransform = { scale: number; x: number; y: number };
type Gesture = { kind: 'rest' } | { kind: 'drag'; pointerId: number; x: number; y: number };
export type ImagePreviewState = {
  transform: ImageTransform;
  gesture: Gesture;
  animate: boolean;
} & ({ status: 'loading' } | { status: 'ready' } | { status: 'error' });
export const initialImagePreview: ImagePreviewState = {
  status: 'loading',
  transform: { scale: 1, x: 0, y: 0 },
  gesture: { kind: 'rest' },
  animate: false,
};
export type ImagePreviewEvent =
  | { type: 'loaded' | 'failed' | 'release' }
  | { type: 'transform'; transform: ImageTransform; animate: boolean }
  | { type: 'drag'; pointerId: number; x: number; y: number };
export function imagePreviewReducer(
  state: ImagePreviewState,
  event: ImagePreviewEvent,
): ImagePreviewState {
  switch (event.type) {
    case 'loaded':
      return state.status === 'loading' ? { ...state, status: 'ready' } : state;
    case 'failed':
      return { ...state, status: 'error', gesture: { kind: 'rest' } };
    case 'release':
      return { ...state, gesture: { kind: 'rest' } };
    case 'transform':
      return {
        ...state,
        transform: event.transform,
        animate: event.animate,
        gesture: event.transform.scale === 1 ? { kind: 'rest' } : state.gesture,
      };
    case 'drag':
      return state.status === 'ready' && state.transform.scale > 1
        ? {
            ...state,
            gesture: { kind: 'drag', pointerId: event.pointerId, x: event.x, y: event.y },
            animate: false,
          }
        : state;
  }
}
