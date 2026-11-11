export type ImageState = { kind: 'loading' | 'ready' | 'error'; src: string };
export type ImageEvent = { type: 'source' | 'ready' | 'error'; src: string };
export function imageReducer(state: ImageState, event: ImageEvent): ImageState {
  if (event.type === 'source')
    return state.src === event.src ? state : { kind: 'loading', src: event.src };
  if (event.src !== state.src || state.kind !== 'loading') return state;
  return { kind: event.type, src: event.src };
}
