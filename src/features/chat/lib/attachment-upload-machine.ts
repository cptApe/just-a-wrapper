import type { PendingAttachment } from './attachments';

type UploadEvent =
  | { type: 'start' | 'interrupt' }
  | { type: 'ready'; prepared: Extract<PendingAttachment, { status: 'ready' }>['prepared'] }
  | { type: 'failed'; error: string };

export function reduceAttachmentUpload(
  state: PendingAttachment,
  event: UploadEvent,
): PendingAttachment {
  const pick = { id: state.id, file: state.file, previewUrl: state.previewUrl };
  if (event.type === 'start') {
    return state.status === 'local' || state.status === 'failed'
      ? { ...pick, status: 'uploading' }
      : state;
  }
  if (state.status !== 'uploading') return state;
  switch (event.type) {
    case 'ready':
      return { ...pick, status: 'ready', prepared: event.prepared };
    case 'failed':
      return { ...pick, status: 'failed', error: event.error };
    case 'interrupt':
      return { ...pick, status: 'local' };
  }
}
