'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent } from 'react';
import { beginSessionActivity } from '@/features/sessions/browser';
import { buildOptimisticAttachments } from '@/features/sessions/lib/build-composer-message';
import { isExpectedUserStateError } from '@/lib/expected-state-error';
import { captureException } from '@/lib/observability-client';
import type { createAttachmentPreviewOwner } from '../lib/attachment-preview-owner';
import { ATTACHMENTS_ONLY_MESSAGE, type ComposerSubmission } from '../lib/composer-submission';
import { type ComposerSubmitState, reduceComposerSubmit } from '../lib/composer-submit-machine';
import {
  dispatchComposerDraft,
  readComposerDraft,
  restoreComposerDraft,
  sessionIdOfDraft,
} from '../lib/draft-store';
import { workspaceClientGeneration } from '../lib/workspace-client-state';
import { useMachineStore } from './use-machine-store';

type UploadGate = 'ready' | 'uploading' | 'failed';

/** Sends the draft once its uploads allow it: one snapshot, one clear, and one restore if the send fails. */
export function useComposerSubmit({
  draftKey,
  canSubmit,
  hasContent,
  uploadGate,
  onSend,
  previewOwner,
}: {
  draftKey: string;
  canSubmit: boolean;
  hasContent: boolean;
  uploadGate: UploadGate;
  onSend: (submission: ComposerSubmission) => void | Promise<void>;
  previewOwner: ReturnType<typeof createAttachmentPreviewOwner>;
}) {
  const queryClient = useQueryClient();
  const { state, dispatch, getSnapshot } = useMachineStore<
    ComposerSubmitState,
    Parameters<typeof reduceComposerSubmit>[1]
  >({ kind: 'idle' }, reduceComposerSubmit);

  async function submit(attempt: symbol) {
    const workspaceGeneration = workspaceClientGeneration();
    const sessionId = sessionIdOfDraft(draftKey);
    const rollbackActivity = sessionId ? beginSessionActivity(queryClient, sessionId) : undefined;
    const sent = readComposerDraft(draftKey);
    dispatchComposerDraft(draftKey, { type: 'clear' });
    try {
      try {
        await onSend({
          draft: sent,
          text: sent.text.trim() || ATTACHMENTS_ONLY_MESSAGE,
          optimisticAttachments: buildOptimisticAttachments(sent.attachments),
          claimAttachmentPreviews: () => previewOwner.claim(sent.attachments),
        });
      } finally {
        previewOwner.release(sent.attachments.map((attachment) => attachment.id));
      }
    } catch (error) {
      if (workspaceGeneration !== workspaceClientGeneration()) return;
      rollbackActivity?.();
      // The surface shows the failure; the composer puts back what it cleared.
      if (!isExpectedUserStateError(error)) {
        captureException(error, { op: 'composer-send-restore', draftKey });
      }
      restoreComposerDraft(draftKey, sent);
    } finally {
      dispatch({ type: 'settled', attempt });
    }
  }

  function requestWithGate(gate: UploadGate) {
    const attempt = Symbol('submit');
    dispatch({ type: 'request', canSubmit, gate, attempt });
    const current = getSnapshot();
    if (current.kind === 'submitting' && current.attempt === attempt) void submit(attempt);
  }

  const armed = state.kind === 'armed';
  const fireArmed = useEffectEvent(() => {
    const attempt = Symbol('armed-submit');
    if (dispatch({ type: 'ready', canSubmit, attempt })) void submit(attempt);
  });
  useEffect(() => {
    if (!hasContent) {
      dispatch({ type: 'emptied' });
      return;
    }
    if (!armed || uploadGate !== 'ready' || !canSubmit) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) fireArmed();
    });
    return () => controller.abort();
  }, [armed, uploadGate, canSubmit, hasContent, dispatch]);

  return {
    requestSubmit: () => requestWithGate(uploadGate),
    // A file added in the same event is not in this render's draft yet, so the send waits for it.
    requestSubmitAfterUpload: () => requestWithGate('uploading'),
    sendArmed: armed,
  };
}
