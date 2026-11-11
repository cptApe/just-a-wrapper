export type ThumbnailState = { kind: 'thumbnail' } | { kind: 'original' } | { kind: 'failed' };

// Image errors advance once to the original, then remain failed.
export function thumbnailReducer(state: ThumbnailState): ThumbnailState {
  switch (state.kind) {
    case 'thumbnail':
      return { kind: 'original' };
    case 'original':
      return { kind: 'failed' };
    case 'failed':
      return state;
  }
}
