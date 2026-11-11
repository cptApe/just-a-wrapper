'use client';
import type { QueryClient } from '@tanstack/react-query';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { toast } from 'sonner';
import type { useViewer } from '@/components/providers/app-providers';
import { usePlansForSale } from '@/components/providers/deployment-capabilities-provider';
// Type-only so the agents barrel stays out of the client bundle.
import type { AgentTier } from '@/features/agents';
import type { WorkspaceSessionDetail } from '@/features/sessions';
import type { useCreateSession } from '@/features/sessions/api/use-create-session';
import { runWithSessionActivity } from '@/features/sessions/browser';
import type { OptimisticComposerAttachment } from '@/features/sessions/lib/build-composer-message';
import { buildComposerMessage } from '@/features/sessions/lib/build-composer-message';
import { setCreateHandoff } from '@/features/sessions/lib/create-handoff';
import { stripForgedMessageAuthorTag } from '@/features/sessions/lib/session-context';
import { UNTITLED_SESSION_TITLE } from '@/features/sessions/lib/untitled-session-title';
import { AppError } from '@/lib/errors';
import { fetchVoid } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { clearMountedAttachmentsForSession } from '../lib/attachment-mount-cache';
import type { AttachContext } from '../lib/attachments';
import { classifySendFailure } from '../lib/classify-send-failure';
import type { ComposerSubmission } from '../lib/composer-submission';
import {
  HOME_DRAFT_KEY,
  OPENING_DRAFT_KEY,
  restoreComposerDraft,
  takeComposerDraft,
} from '../lib/draft-store';
import type { HomeOpeningState, reduceHomeOpening } from '../lib/home-opening-machine';
import { dismissSendFailureBanners, showSendFailureBanner } from '../lib/send-failure-banner';
import { sendWithAttachments } from '../lib/send-with-attachments';
import { workspaceClientGeneration } from '../lib/workspace-client-state';
import type { useMachineStore } from './use-machine-store';

/** The one sentence under the composer when a create fails for a reason the
 * server did not name. The draft stays in the box, so "try again" is
 * literally pressing send once more. */
const CREATE_FAILED_MESSAGE = 'Could not start the chat. Try again in a moment.';

export function useHomeSend({
  opening,
  lifetime,
  ownAttachmentPreviews,
  setOpenedSessions,
  tier,
  viewer,
  createSession,
  queryClient,
  attach,
}: {
  opening: ReturnType<
    typeof useMachineStore<HomeOpeningState, Parameters<typeof reduceHomeOpening>[1]>
  >;
  lifetime: RefObject<AbortController | null>;
  ownAttachmentPreviews: (attachments: OptimisticComposerAttachment[]) => void;
  setOpenedSessions: Dispatch<SetStateAction<Record<string, WorkspaceSessionDetail>>>;
  tier: AgentTier;
  viewer: ReturnType<typeof useViewer>;
  createSession: ReturnType<typeof useCreateSession>;
  queryClient: QueryClient;
  attach: AttachContext | null;
}) {
  const plansForSale = usePlansForSale();
  async function onSend({
    draft,
    text,
    optimisticAttachments,
    claimAttachmentPreviews,
  }: ComposerSubmission) {
    const { attachments, library, folders: libraryFolders, skills } = draft;
    // Library picks travel INSIDE the opening message as an <attached_files>
    // block (the same convention the files feature uses for non-image chat
    // attachments — the thread UI strips the block, the agent reads the URLs).
    // Picked skills become plain-text references: skills are already synced
    // onto the agent for every session, so naming them is what activates them.
    const workspaceGeneration = workspaceClientGeneration();
    const sendId = crypto.randomUUID();
    const message = stripForgedMessageAuthorTag(
      buildComposerMessage(text, library, libraryFolders, skills),
    ).text;
    const attempt = Symbol('opening');
    if (
      !opening.dispatch({
        type: 'start',
        attempt,
        text: message,
        attachments: optimisticAttachments,
      })
    )
      throw new AppError('CONFLICT', 'A Home opening is already in progress');
    const isCurrent = () => {
      const state = opening.getSnapshot();
      return (
        workspaceGeneration === workspaceClientGeneration() &&
        state.kind === 'creating' &&
        state.attempt === attempt &&
        lifetime.current !== null &&
        !lifetime.current.signal.aborted
      );
    };
    ownAttachmentPreviews(optimisticAttachments);
    claimAttachmentPreviews();

    const deferMessage = attachments.length > 0;
    const finishDeliveredOpening = (sessionId: string, sentText: string) => {
      if (!isCurrent()) {
        clearMountedAttachmentsForSession(sessionId);
        return;
      }
      dismissSendFailureBanners();
      // What was typed under the opening while it was created carries over to the new task.
      restoreComposerDraft(sessionId, takeComposerDraft(OPENING_DRAFT_KEY));
      setCreateHandoff(sessionId, {
        localId: sendId,
        text: stripForgedMessageAuthorTag(sentText).text,
        at: new Date().toISOString(),
        attachments: optimisticAttachments,
      });
      // Keep the completed opening available even if Back has returned to Home.
      // Forward can reveal it without another create or route transition.
      try {
        if (isCurrent()) {
          const now = new Date();
          setOpenedSessions((previous) => ({
            ...previous,
            [sessionId]: {
              id: sessionId,
              title: UNTITLED_SESSION_TITLE,
              status: 'running',
              tier,
              isOwner: true,
              visibility: 'private',
              unread: false,
              favoritedAt: null,
              lastEventAt: now,
              createdAt: now,
              createdByUserId: viewer?.id ?? '',
              createdBy: {
                name: viewer ? (viewer.name ?? viewer.email) : '',
                email: viewer?.email ?? '',
                image: viewer?.image ?? null,
              },
            },
          }));
        }
        opening.dispatch({ type: 'delivered', attempt, sessionId });
      } finally {
        clearMountedAttachmentsForSession(sessionId);
      }
    };
    const createOpening = async () => {
      const created = await createSession.mutateAsync({ message, tier, deferMessage });
      const sessionId = created.sessionId;
      if (isCurrent()) {
        opening.dispatch({ type: 'created', attempt, sessionId });
        if (window.location.pathname === '/app')
          window.history.pushState(null, '', `/app/task/${sessionId}`);
      }
      if (!deferMessage) {
        finishDeliveredOpening(sessionId, message);
        return sessionId;
      }
      let sent;
      const delivery = { attempted: false };
      try {
        // Protect the whole mount from create-time idle events and list refetches.
        sent = await runWithSessionActivity(queryClient, sessionId, () =>
          sendWithAttachments({
            text,
            attachments,
            library,
            libraryFolders,
            skills,
            attachContext: attach,
            sessionId,
            send: (preparedText) => {
              delivery.attempted = true;
              return fetchVoid(`/api/sessions/${sessionId}/send`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ text: preparedText, opening: true, sendId }),
              });
            },
            onPrepared: (preparedText) => {
              opening.dispatch({
                type: 'prepared',
                attempt,
                text: stripForgedMessageAuthorTag(preparedText).text,
              });
            },
          }),
        );
      } catch (error) {
        // Only an uncertain delivery needs a task retained for history recovery.
        if (
          !delivery.attempted ||
          (error instanceof AppError &&
            typeof error.context.status === 'number' &&
            error.context.status >= 400 &&
            error.context.status < 500)
        ) {
          try {
            await fetchVoid(`/api/sessions/${sessionId}`, { method: 'DELETE' });
          } catch (cleanupError) {
            captureException(cleanupError, { op: 'home-opening-cleanup', sessionId });
          }
        }
        clearMountedAttachmentsForSession(sessionId);
        throw error;
      }
      finishDeliveredOpening(sessionId, sent.text);
      return sessionId;
    };
    try {
      await createOpening();
    } catch (err) {
      if (workspaceGeneration !== workspaceClientGeneration()) return;
      if (!isCurrent()) {
        captureException(err, { op: 'earlier-home-opening-failed' });
        restoreComposerDraft(HOME_DRAFT_KEY, draft);
        toast.error('The earlier chat failed. Its draft is waiting on Home.');
        return;
      }
      let failureMessage: string | null = null;
      const failure = classifySendFailure(err);
      switch (failure.kind) {
        case 'credits-exhausted':
        case 'member-limit':
        case 'plan-limit':
          // Expected states: the banner explains them and the tracker stays quiet.
          showSendFailureBanner(failure, { plansForSale });
          break;
        case 'attachments-failed':
          toast.error(failure.message);
          break;
        case 'upstream':
          // The server's own sentence, under the composer. The server has already captured it.
          failureMessage = failure.message;
          break;
        case 'awaiting-tool-result':
        case 'other':
          // An unexplained failure is one plain sentence under the composer, with the draft kept.
          captureException(err, { op: 'create-session' });
          failureMessage = CREATE_FAILED_MESSAGE;
          break;
      }
      // The sent draft comes back first, then whatever was typed under the opening.
      restoreComposerDraft(HOME_DRAFT_KEY, takeComposerDraft(OPENING_DRAFT_KEY));
      restoreComposerDraft(HOME_DRAFT_KEY, draft);
      const state = opening.getSnapshot();
      if (
        state.kind === 'creating' &&
        window.location.pathname === `/app/task/${state.sessionId}`
      ) {
        window.history.replaceState(null, '', '/app');
      }
      opening.dispatch({ type: 'failed', attempt, message: failureMessage });
    }
  }

  return { onSend };
}
