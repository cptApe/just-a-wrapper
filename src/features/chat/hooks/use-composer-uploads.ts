'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { captureException } from '@/lib/observability-client';
import { createAttachmentPreviewOwner } from '../lib/attachment-preview-owner';
import { reduceAttachmentUpload } from '../lib/attachment-upload-machine';
import { partitionComposerFiles } from '../lib/attachment-validation';
import {
  type AttachContext,
  createPendingAttachment,
  type PendingAttachment,
  preparePendingAttachment,
} from '../lib/attachments';
import { dispatchComposerDraft, sessionIdOfDraft } from '../lib/draft-store';

const UPLOAD_FAILED_MESSAGE = 'Couldn’t upload this file. Retry or remove it.';

/** Uploads the draft's files as they arrive and owns their image previews while they are shown here. */
export function useComposerUploads({
  draftKey,
  attachments,
  attach,
}: {
  draftKey: string;
  attachments: PendingAttachment[];
  attach: AttachContext | null | undefined;
}) {
  const uploadAttempts = useRef(new Map<string, AbortController>());
  const [previewOwner] = useState(createAttachmentPreviewOwner);
  const previewLifetime = useRef<symbol | null>(null);
  const sessionId = sessionIdOfDraft(draftKey);

  useEffect(() => {
    const attempts = uploadAttempts.current;
    const lifetime = Symbol('composer');
    previewLifetime.current = lifetime;
    return () => {
      // React replays effects in development. Only a real unmount owns disposal.
      queueMicrotask(() => {
        if (previewLifetime.current !== lifetime) return;
        previewLifetime.current = null;
        for (const attempt of attempts.values()) attempt.abort();
        attempts.clear();
        previewOwner.dispose();
      });
    };
  }, [previewOwner]);

  const startUpload = useCallback(
    (pending: PendingAttachment) => {
      if (uploadAttempts.current.has(pending.id) || pending.status === 'ready') return;
      const attempt = new AbortController();
      uploadAttempts.current.set(pending.id, attempt);
      const settle = (attachment: PendingAttachment) => {
        if (uploadAttempts.current.get(pending.id) !== attempt) return;
        uploadAttempts.current.delete(pending.id);
        dispatchComposerDraft(draftKey, { type: 'attachment', attachment });
      };
      const uploading = reduceAttachmentUpload(pending, { type: 'start' });
      dispatchComposerDraft(draftKey, { type: 'attachment', attachment: uploading });
      void preparePendingAttachment(uploading, attach ?? null, sessionId, attempt.signal).then(
        settle,
        (error: unknown) => {
          if (uploadAttempts.current.get(pending.id) !== attempt) return;
          captureException(error, { op: 'composer-upload', draftKey });
          settle(
            reduceAttachmentUpload(uploading, { type: 'failed', error: UPLOAD_FAILED_MESSAGE }),
          );
        },
      );
    },
    [attach, draftKey, sessionId],
  );

  // Files restored from a failed send, or handed over from Home, arrive without a preview or an
  // upload. Every file in the draft is shown with its preview and is uploading or uploaded.
  useEffect(() => {
    for (const attachment of attachments) {
      let shown = attachment;
      if (attachment.previewUrl === null && attachment.file.type.startsWith('image/')) {
        shown = { ...attachment, previewUrl: URL.createObjectURL(attachment.file) };
        previewOwner.adopt([shown]);
        dispatchComposerDraft(draftKey, { type: 'attachment', attachment: shown });
      }
      if (shown.status === 'local') startUpload(shown);
    }
  }, [attachments, draftKey, previewOwner, startUpload]);

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      if (attach && !attach.uploadConfig.enabled) {
        toast.error(attach.uploadConfig.reason);
        return;
      }
      const { empty, attachable } = partitionComposerFiles(files);
      const firstEmpty = empty.at(0);
      if (firstEmpty) {
        toast.error(
          empty.length === 1
            ? `${firstEmpty.name} is empty and can’t be attached.`
            : `${empty.length} empty files can’t be attached.`,
        );
      }
      const picks = attachable.map(createPendingAttachment);
      previewOwner.adopt(picks);
      dispatchComposerDraft(draftKey, { type: 'attach', attachments: picks });
      // Started here, not by the effect, so a send armed in this same event sees them uploading.
      for (const pending of picks) startUpload(pending);
    },
    [attach, draftKey, previewOwner, startUpload],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      uploadAttempts.current.get(id)?.abort();
      uploadAttempts.current.delete(id);
      previewOwner.release([id]);
      dispatchComposerDraft(draftKey, { type: 'detach', id });
    },
    [draftKey, previewOwner],
  );

  return { addFiles, retryUpload: startUpload, removeAttachment, previewOwner };
}
