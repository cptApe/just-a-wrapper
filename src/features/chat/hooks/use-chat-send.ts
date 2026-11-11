'use client';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { usePlansForSale } from '@/components/providers/deployment-capabilities-provider';
import type { UploadConfig } from '@/features/files';
import type { ChatEvent } from '@/features/sessions';
import type { OptimisticComposerAttachment } from '@/features/sessions/lib/build-composer-message';
import { buildComposerMessage } from '@/features/sessions/lib/build-composer-message';
// Direct import avoids the server-only sessions barrel.
import { stripForgedMessageAuthorTag } from '@/features/sessions/lib/session-context';
import { TASK_RETRY_MESSAGE } from '@/features/sessions/lib/translate-message-event';
import { AppError } from '@/lib/errors';
import { fetchJson, fetchVoid } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { cancelOptimisticSendEvent, optimisticSendEvent } from '../lib/chat-store';
import { classifySendFailure, taskComposerFailureMessage } from '../lib/classify-send-failure';
import type { ComposerSubmission } from '../lib/composer-submission';
import type { PendingSendAction } from '../lib/pending-send-machine';
import type { LocalSend } from '../lib/reconcile-pending';
import { dismissSendFailureBanners, showSendFailureBanner } from '../lib/send-failure-banner';
import { sendWithAttachments } from '../lib/send-with-attachments';
import { workspaceClientGeneration } from '../lib/workspace-client-state';
import type { EventStream } from './use-event-stream';
import { useMessageAttachmentPreviews } from './use-message-attachment-previews';

/** The send route's response: the platform's echo of the posted user.message.
 *  `processedAt` is null while the message is still queued behind earlier
 *  events (a mid-run send the agent hasn't reached yet). */
const sendResponseSchema = z.object({
  event: z.object({ id: z.string(), processedAt: z.string().nullable() }),
});

export function useChatSend({
  foldEvent,
  working,
  status,
  statusAt,
  isQuietStale,
  remint,
  sessionId,
  dispatchPending,
  getPending,
  setSendError,
  sendQueue,
  workspaceId,
  uploadConfig,
}: {
  foldEvent: (event: ChatEvent) => void;
  working: boolean;
  status: EventStream['status'];
  statusAt: string | null;
  isQuietStale: () => boolean;
  remint: () => void;
  sessionId: string;
  dispatchPending: (action: PendingSendAction) => boolean;
  getPending: () => LocalSend[];
  setSendError: Dispatch<SetStateAction<string | null>>;
  sendQueue: { run: <T>(operation: () => Promise<T>) => Promise<T> };
  workspaceId: string | undefined;
  uploadConfig: UploadConfig | undefined;
}) {
  const plansForSale = usePlansForSale();
  const doSend = useCallback(
    async (
      localId: string,
      text: string,
      restoreComposerDraft: boolean,
      attachments: OptimisticComposerAttachment[],
    ) => {
      const workspaceGeneration = workspaceClientGeneration();
      foldEvent(optimisticSendEvent(localId, text, { queued: working, attachments }));
      // A settled or quiet-stale stream remints BEFORE the POST,
      // not after it: the remint and the send run in parallel,
      // so the new turn's first events arrive ~1 RTT (~1s measured) sooner.
      // History replay + the seen-set dedup make the early re-attach idempotent,
      // and a failed send just leaves a freshly-attached idle stream behind.
      // A still-open stream picks the turn up on its own.
      if (status === 'done' || status === 'error' || isQuietStale()) remint();
      try {
        const { event } = await fetchJson(`/api/sessions/${sessionId}/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, sendId: localId }),
        }).then((body) => sendResponseSchema.parse(body));
        if (workspaceGeneration === workspaceClientGeneration()) dismissSendFailureBanners();
        // The echo carries the REAL event id (the precise reconcile key) and
        // whether the platform already processed the message — a set
        // processedAt means it is NOT queued, so the card graduates.
        // Fold queued echoes too. Their stable id replaces the local anchor;
        // processedAt may arrive later through the stream's normal re-delivery.
        foldEvent({
          id: event.id,
          kind: 'message',
          rawType: 'user.message',
          role: 'user',
          sendId: localId,
          text,
          ...(event.processedAt ? { at: event.processedAt } : {}),
        });
        dispatchPending({
          type: 'delivered',
          localId,
          eventId: event.id,
          processedAt: event.processedAt,
        });
      } catch (error) {
        const pending = getPending().find((entry) => entry.localId === localId);
        if (!pending || pending.status === 'delivered') return;
        if (
          !(error instanceof AppError) ||
          error.context.status === undefined ||
          error.context.serverCode === 'SEND_UNCONFIRMED'
        ) {
          dispatchPending({ type: 'unconfirmed', localId });
          remint();
          return;
        }
        foldEvent(cancelOptimisticSendEvent(localId));
        const failure = classifySendFailure(error);
        let bubbleMessage: string | undefined;
        switch (failure.kind) {
          case 'upstream':
            // An Anthropic outage belongs under the composer. The server has already captured it.
            setSendError(failure.message);
            dispatchPending({ type: 'failed', localId, message: failure.message });
            return;
          case 'credits-exhausted':
          case 'member-limit':
          case 'plan-limit':
            // Expected states: the shared banner explains them, as it does on Home.
            if (failure.kind === 'credits-exhausted') bubbleMessage = 'Add credits to retry';
            if (workspaceGeneration === workspaceClientGeneration())
              showSendFailureBanner(failure, { plansForSale });
            break;
          case 'awaiting-tool-result':
            bubbleMessage = failure.message;
            break;
          case 'attachments-failed':
          case 'other':
            captureException(error, { sessionId, op: 'send-message' });
            break;
        }
        const composerFailure = taskComposerFailureMessage(error);
        if (composerFailure && restoreComposerDraft) {
          setSendError(composerFailure);
          throw error;
        }
        dispatchPending({ type: 'failed', localId, message: bubbleMessage });
        // The expected-error bubble/banner above stays visible, but a failed
        // composer send must also reject so its optimistic activity rolls back.
        if (restoreComposerDraft) throw error;
      }
    },
    [
      sessionId,
      status,
      remint,
      isQuietStale,
      foldEvent,
      working,
      dispatchPending,
      getPending,
      setSendError,
      plansForSale,
    ],
  );

  const ownAttachmentPreviews = useMessageAttachmentPreviews();

  async function onSend({
    draft,
    text,
    optimisticAttachments,
    claimAttachmentPreviews,
  }: ComposerSubmission) {
    const { attachments, library, folders: libraryFolders, skills } = draft;
    ownAttachmentPreviews(optimisticAttachments);
    claimAttachmentPreviews();
    setSendError(null);
    const localId = crypto.randomUUID();
    const message = buildComposerMessage(text, library, libraryFolders, skills);
    // Mirror the server's anti-spoof strip so a user who typed a literal
    // <message_author/> line sees exactly what the server persists (the stripped
    // text), and the optimistic bubble reconciles cleanly against the echo (which
    // is server-stripped too). Without this the raw tag would linger, unmatched,
    // as a phantom bubble. A no-op on ordinary text.
    const sendText = stripForgedMessageAuthorTag(message).text;
    // A mid-turn send POSTs immediately like any other — the platform natively
    // absorbs mid-run user messages at its earliest opportunity — but PRESENTS
    // in the queued stack above the composer (midRun) until the agent reaches
    // it, instead of appearing as a thread bubble while it's still waiting.
    dispatchPending({
      type: 'add',
      send: {
        localId,
        text: sendText,
        attachments: optimisticAttachments,
        status: 'sending',
        statusAtSend: statusAt ? Date.parse(statusAt) : undefined,
        midRun: working,
      },
    });
    const delivery = { attempted: false };
    try {
      await sendQueue.run(() =>
        sendWithAttachments({
          text,
          attachments,
          library,
          libraryFolders,
          skills,
          attachContext: workspaceId && uploadConfig ? { workspaceId, uploadConfig } : null,
          sessionId,
          send: async (preparedText) => {
            const finalText = stripForgedMessageAuthorTag(preparedText).text;
            dispatchPending({ type: 'prepared', localId, text: finalText });
            delivery.attempted = true;
            await doSend(localId, finalText, true, optimisticAttachments);
          },
        }).then(() => undefined),
      );
    } catch (error) {
      if (!delivery.attempted) {
        const failure = classifySendFailure(error);
        toast.error(
          failure.kind === 'attachments-failed' ? failure.message : 'Couldn’t attach the files.',
        );
      }
      // Expected billing/approval failures retain their per-bubble treatment.
      // Other failures restore only the draft and the inline composer error.
      if (!delivery.attempted || taskComposerFailureMessage(error) !== null) {
        dispatchPending({ type: 'remove', localId });
      }
      throw error;
    }
  }

  const onRetry = useCallback(
    (localId: string, text: string) => {
      setSendError(null);
      // Re-derive the presentation at retry time: the agent may have settled
      // (or started running) since the failed attempt, and the retried send
      // belongs wherever a fresh send would go now.
      const entry = getPending().find((item) => item.localId === localId);
      if (!entry || entry.status !== 'error') return;
      dispatchPending({
        type: 'retry',
        localId,
        midRun: working,
        statusAtSend: statusAt ? Date.parse(statusAt) : undefined,
      });
      void sendQueue.run(() => doSend(localId, text, false, entry.attachments ?? []));
    },
    [doSend, sendQueue, working, getPending, dispatchPending, setSendError, statusAt],
  );

  // Managed Agents has no retry call: a new user turn is the way to continue a stopped session.
  // Translation hides this exact text, so the retry never appears as something the person said.
  const retryTask = async () => {
    if (status === 'done' || status === 'error' || isQuietStale()) remint();
    await sendQueue.run(() =>
      fetchVoid(`/api/sessions/${sessionId}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: TASK_RETRY_MESSAGE }),
      }),
    );
  };
  return { onRetry, onSend, retryTask };
}
