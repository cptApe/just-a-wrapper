import type { PendingAttachment } from '@/features/chat/lib/attachments';
import type { ComposerLibraryFile, ComposerLibraryFolder } from '@/features/sessions/types';

type Selection = {
  pending: PendingAttachment[];
  files: ComposerLibraryFile[];
  folders: ComposerLibraryFolder[];
};
export type ScheduleAttachmentsState = Selection &
  ({ kind: 'ready' | 'attached' | 'failed' } | { kind: 'uploading'; attempt: string });
type Change<T> = T | ((previous: T) => T);
type AttachmentEvent =
  | { type: 'pending'; value: Change<PendingAttachment[]> }
  | { type: 'files'; value: Change<ComposerLibraryFile[]> }
  | { type: 'folders'; value: Change<ComposerLibraryFolder[]> }
  | { type: 'begin'; attempt: string }
  | { type: 'uploaded'; attempt: string; pendingId: string; files: ComposerLibraryFile[] }
  | { type: 'finish'; attempt: string; failed: boolean };

function changed<T extends unknown[]>(previous: T, value: Change<T>): T {
  return typeof value === 'function' ? value(previous) : value;
}

export function scheduleAttachmentsReducer(
  state: ScheduleAttachmentsState,
  event: AttachmentEvent,
): ScheduleAttachmentsState {
  switch (event.type) {
    case 'pending':
      return state.kind === 'uploading'
        ? state
        : { ...state, kind: 'ready', pending: changed(state.pending, event.value) };
    case 'files':
      return state.kind === 'uploading'
        ? state
        : { ...state, files: changed(state.files, event.value) };
    case 'folders':
      return state.kind === 'uploading'
        ? state
        : { ...state, folders: changed(state.folders, event.value) };
    case 'begin':
      return state.kind === 'uploading'
        ? state
        : { ...state, kind: 'uploading', attempt: event.attempt };
    case 'uploaded':
      if (state.kind !== 'uploading' || state.attempt !== event.attempt) return state;
      return {
        ...state,
        files: [...state.files, ...event.files],
        pending: state.pending.filter((file) => file.id !== event.pendingId),
      };
    case 'finish':
      if (state.kind !== 'uploading' || state.attempt !== event.attempt) return state;
      return {
        pending: state.pending,
        files: state.files,
        folders: state.folders,
        kind: event.failed ? 'failed' : 'attached',
      };
  }
}
