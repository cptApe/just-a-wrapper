import type { SkillFileEntry } from '../types';

type Review = { files: SkillFileEntry[]; name: string; description: string };
export type ReviewStage =
  | { kind: 'closed' }
  | { kind: 'reading'; attempt: string }
  | ({ kind: 'review' } & Review)
  | ({ kind: 'saving'; attempt: string } & Review);
export type UploadEvent =
  | { type: 'read'; attempt: string }
  | { type: 'loaded'; attempt: string; review: Review }
  | { type: 'readFailed'; attempt: string }
  | { type: 'edit'; name: string; description: string }
  | { type: 'close' }
  | { type: 'save'; attempt: string }
  | { type: 'saved' | 'failed'; attempt: string };
export function reduceUpload(state: ReviewStage, event: UploadEvent): ReviewStage {
  switch (event.type) {
    case 'read':
      return state.kind === 'saving' ? state : { kind: 'reading', attempt: event.attempt };
    case 'loaded':
      return state.kind === 'reading' && state.attempt === event.attempt
        ? { kind: 'review', ...event.review }
        : state;
    case 'readFailed':
      return state.kind === 'reading' && state.attempt === event.attempt
        ? { kind: 'closed' }
        : state;
    case 'edit':
      return state.kind === 'review'
        ? { ...state, name: event.name, description: event.description }
        : state;
    case 'close':
      return state.kind === 'saving' ? state : { kind: 'closed' };
    case 'save':
      return state.kind === 'review' ? { ...state, kind: 'saving', attempt: event.attempt } : state;
    case 'saved':
      return state.kind === 'saving' && state.attempt === event.attempt
        ? { kind: 'closed' }
        : state;
    case 'failed':
      return state.kind === 'saving' && state.attempt === event.attempt
        ? { kind: 'review', files: state.files, name: state.name, description: state.description }
        : state;
  }
}
