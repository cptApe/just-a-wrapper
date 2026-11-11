export type ProfileUploadState =
  | { kind: 'idle' }
  | { kind: 'ready'; file: File; previewUrl: string }
  | { kind: 'uploading'; file: File; previewUrl: string; progress: number; attempt: symbol }
  | { kind: 'error'; message: string }
  | { kind: 'success' };
export type ProfileUploadEvent =
  | { type: 'reset' }
  | { type: 'select'; file: File; previewUrl: string }
  | { type: 'invalid'; message: string }
  | { type: 'start'; attempt: symbol }
  | { type: 'progress'; attempt: symbol; progress: number }
  | { type: 'failed' | 'saved'; attempt: symbol };
export function profileUploadReducer(
  state: ProfileUploadState,
  event: ProfileUploadEvent,
): ProfileUploadState {
  switch (event.type) {
    case 'reset':
      return state.kind === 'uploading' ? state : { kind: 'idle' };
    case 'select':
      return state.kind === 'uploading'
        ? state
        : { kind: 'ready', file: event.file, previewUrl: event.previewUrl };
    case 'invalid':
      return state.kind === 'uploading' ? state : { kind: 'error', message: event.message };
    case 'start':
      return state.kind === 'ready'
        ? { ...state, kind: 'uploading', progress: 0, attempt: event.attempt }
        : state;
    case 'progress':
      return state.kind === 'uploading' && state.attempt === event.attempt
        ? { ...state, progress: event.progress }
        : state;
    case 'failed':
      return state.kind === 'uploading' && state.attempt === event.attempt
        ? { kind: 'ready', file: state.file, previewUrl: state.previewUrl }
        : state;
    case 'saved':
      return state.kind === 'uploading' && state.attempt === event.attempt
        ? { kind: 'success' }
        : state;
  }
}
