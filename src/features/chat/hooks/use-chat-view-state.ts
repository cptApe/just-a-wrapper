'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UploadConfig } from '@/features/files';
// Direct hook import keeps the artifacts server barrel out of the client bundle.
import { useSessionArtifacts } from '@/features/files/hooks/use-session-artifacts';
import type { ArtifactSummary } from '@/features/files/types';
import type { SessionLiveState, WorkspaceSessionDetail } from '@/features/sessions';
import { setSessionDispatchExecuting } from '@/features/sessions/api/session-live-cache';
import { useAsyncAction } from '@/hooks/use-async-action';
import { fetchVoid } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import {
  organizationId as trustedOrganizationId,
  workspaceId as trustedWorkspaceId,
} from '@/lib/tenant-id';
import { useChatContext } from '../api/use-chat-context';
import type { QueuedCardItem } from '../components/composer-queue';
import { clearMountedAttachmentsForSession } from '../lib/attachment-mount-cache';
import { selectQueuedTail } from '../lib/chat-turns';
import { isChatWorking } from '../lib/chat-working';
import { reconcilePending, toQueueCard } from '../lib/reconcile-pending';
import { createSerialSendQueue } from '../lib/serial-send-queue';
import type { AuthorChip, ThreadMember } from '../types';
import { useChatBrowser } from './use-chat-browser';
import { useChatCreditPause } from './use-chat-credit-pause';
import { useChatSend } from './use-chat-send';
import { useEventStream } from './use-event-stream';
import { usePendingSends } from './use-pending-sends';
import { useToolDecisions } from './use-tool-decisions';

export function useChatViewState({
  organizationId: suppliedOrganizationId,
  sessionId,
  loadContext,
  suppliedSession,
  suppliedMembers,
  suppliedWorkspaceId,
  suppliedUploadConfig,
  suppliedStatus,
  userId,
}: {
  organizationId: string | undefined;
  sessionId: string;
  loadContext: boolean;
  suppliedSession: WorkspaceSessionDetail | null;
  suppliedMembers: ThreadMember[] | undefined;
  suppliedWorkspaceId: string | undefined;
  suppliedUploadConfig: UploadConfig | undefined;
  suppliedStatus: SessionLiveState | null | undefined;
  userId: string | undefined;
}) {
  const organizationId = suppliedOrganizationId
    ? trustedOrganizationId(suppliedOrganizationId)
    : undefined;
  const queryClient = useQueryClient();
  const context = useChatContext(organizationId, sessionId, loadContext);
  const session = context.data?.session ?? suppliedSession;
  const members = context.data?.members ?? suppliedMembers;
  const rawWorkspaceId = context.data?.workspaceId ?? suppliedWorkspaceId;
  const workspaceId = rawWorkspaceId ? trustedWorkspaceId(rawWorkspaceId) : undefined;
  const uploadConfig = context.data?.uploadConfig ?? suppliedUploadConfig;
  const initialStatus = context.data?.initialStatus ?? suppliedStatus;
  // Sharing grants transcript access, never control of the creator's resources.
  const canWrite = session ? session.isOwner : true;
  // Stable identity: each memoized turn receives this resolver.
  const resolveAuthor = useCallback(
    (author: { userId: string; name: string }): AuthorChip => {
      const member = members?.find((candidate) => candidate.userId === author.userId);
      return { name: member?.name ?? author.name, image: member?.image ?? null };
    },
    [members],
  );

  const { state, status, meta, remint, foldEvent, isQuietStale, replaySettled } =
    useEventStream(sessionId);

  // The live browser is the primary surface for persistent browsing: open its
  // shared side panel on the newest browse_open call, and collapse it once the
  // matching lifecycle closes. A handled use id never auto-opens twice, so a
  // viewer can dismiss the panel without the next stream render fighting them.
  useChatBrowser({ state, sessionId, canWrite });

  const { decisions: toolDecisions, autoDispatchToolUseIds } = useToolDecisions({
    sessionId,
    state,
    replaySettled,
    reattach: remint,
    foldEvent,
    canDecide: canWrite,
    canSetGlobalPermission: session?.isOwner ?? false,
  });
  const stopRequest = useAsyncAction();
  const stopCompletion = useRef<(() => void) | null>(null);
  const stopping = stopRequest.pending;
  const [sendError, setSendError] = useState<string | null>(null);
  // Seed the optimistic bubble from the Home → task handoff so the user's
  // opening message is on screen from the first client render, before the relay
  // replays it. The initializer only peeks, so React StrictMode's dev double-invoke
  // cannot drop the entry; an effect in usePendingSends clears it once. When the
  // echoed user.message lands, reconcilePending removes the bubble.
  const { pending, dispatchPending, getPending } = usePendingSends({
    sessionId,
    foldEvent,
    items: state.items,
    replaySettled,
    statusAt: state.statusAt,
  });

  const latestLocalMessage = state.items.findLast(
    (item) => item.type === 'message' && item.localId !== undefined,
  );
  const latestPending = pending.at(-1);
  const pinPending = latestPending
    ? !latestPending.midRun
    : latestLocalMessage?.type === 'message'
      ? latestLocalMessage.presentation !== 'stack'
      : true;
  const [sendQueue] = useState(() => createSerialSendQueue());
  useEffect(
    () => () => {
      clearMountedAttachmentsForSession(sessionId);
    },
    [sessionId],
  );
  // Session artifacts, correlated to messages by Anthropic file id — resolves
  // the ids the per-turn files strip (TurnFiles) renders. Still session-scoped;
  // the header's "Files in this task" button remains the all-files surface.
  const artifacts = useSessionArtifacts(sessionId, {
    status: state.status,
    artifactSignal: state.artifactSignal,
  });
  const artifactsByFileId = useMemo(() => {
    const map = new Map<string, ArtifactSummary>();
    for (const artifact of artifacts.state.artifacts) map.set(artifact.anthropicFileId, artifact);
    return map;
  }, [artifacts.state.artifacts]);

  // Mid-session exhaustion: the banner is driven by the session's
  // LIVE status — seeded from the page-load DB read, then flipped by
  // `session_status` events on the workspace channel. A top-up grant publishes
  // `running`, which clears it and re-attaches the SSE stream so the resumed
  // reply streams in without a refresh.
  const { pausedNoCredits, pausedReason, onResume, resuming } = useChatCreditPause({
    initialStatus,
    foldEvent,
    organizationId,
    userId,
    sessionId,
    remint,
    status,
    state,
  });

  // Stable IDs fold each pending send into its transcript anchor.
  const { visible: visiblePending, presentation: echoPresentation } = reconcilePending(
    pending,
    state.items,
  );

  const sendInFlight = pending.some((entry) => entry.status !== 'error');
  const working = isChatWorking({
    state,
    streamStatus: status,
    sendInFlight,
    pendingUserToolUseIds: toolDecisions.pending,
    autoDispatchToolUseIds,
  });
  useEffect(() => {
    if (organizationId)
      setSessionDispatchExecuting(queryClient, organizationId, sessionId, working);
    return () => {
      if (organizationId)
        setSessionDispatchExecuting(queryClient, organizationId, sessionId, false);
    };
  }, [queryClient, organizationId, sessionId, working]);
  // Only a completed history replay establishes that the task is empty.
  const empty = state.items.length === 0 && visiblePending.length === 0;
  const attached = replaySettled && (status === 'open' || status === 'done');
  // Reveal history after initial replay settles to avoid visible scroll chasing.
  // Optimistic user messages reveal immediately. Latch the first reveal so
  // reconnects cannot blank an existing transcript.
  const [revealed, revealWhen] = useState(false);
  if (!revealed && (attached || visiblePending.length > 0 || meta.error)) revealWhen(true);
  const connecting = !revealed;

  useEffect(() => {
    if (!working) stopCompletion.current?.();
    return () => stopCompletion.current?.();
  }, [working]);
  const onStop = () =>
    stopRequest.run(async () => {
      if (pausedNoCredits || !working) return;
      const completion = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          stopCompletion.current = null;
          resolve();
        }, 30_000);
        stopCompletion.current = () => {
          clearTimeout(timer);
          stopCompletion.current = null;
          resolve();
        };
      });
      try {
        await fetchVoid(`/api/sessions/${sessionId}/interrupt`, {
          method: 'POST',
          signal: AbortSignal.timeout(30_000),
        });
        if (status === 'done' || status === 'error' || isQuietStale()) remint();
        await completion;
      } catch (error) {
        captureException(error, { sessionId, op: 'interrupt-session' });
      } finally {
        stopCompletion.current?.();
      }
    });

  const { onRetry, onSend, retryTask } = useChatSend({
    statusAt: state.statusAt,
    foldEvent,
    working,
    status,
    isQuietStale,
    remint,
    sessionId,
    dispatchPending,
    getPending,
    setSendError,
    sendQueue,
    workspaceId,
    uploadConfig,
  });

  // The presentation diversion: user messages the platform has NOT processed
  // yet (processed_at null → item `at` unset, the platform's own queued state)
  // render as queued cards above the composer, not as thread bubbles. They
  // graduate the moment their processed_at becomes known (send response,
  // history re-delivery) or anything folds in after them in the stream — or
  // when the run settles. Reload-safe by construction: the tail derives purely
  // from stream data. The walk keeps items pinned to the thread by their own
  // pending entry — above all the send that STARTED the run, whose echo can
  // briefly trail unprocessed before the first agent event — and stops there
  // so the diverted set stays a clean suffix of the item list.
  // A locally pending send and a running custom tool also keep the queue
  // active while the platform's status is still idle or requires_action.
  const queuedTail = working ? selectQueuedTail({ ...state, status: 'running' }) : [];
  const stackTail: typeof queuedTail = [];
  for (const item of [...queuedTail].reverse()) {
    if (echoPresentation.get(item.id) === 'thread') break;
    stackTail.unshift(item);
  }
  const threadItems =
    stackTail.length > 0
      ? state.items.slice(0, state.items.length - stackTail.length)
      : state.items;
  // Pre-echo optimistic sends present in the stack when made mid-turn, unless
  // the send response already reported them processed.
  const stackPending = visiblePending.filter((p) => p.midRun && !p.serverProcessedAt);
  const threadPending = visiblePending.filter((p) => !stackPending.includes(p));
  const queueCards: QueuedCardItem[] = [
    ...stackTail.map((item) => toQueueCard(item.id, item.text, 'queued')),
    ...stackPending.map((p) =>
      toQueueCard(p.localId, p.text, p.status === 'error' ? 'error' : 'queued'),
    ),
  ];
  // Retry from an errored card: only pending (unsent) cards can error, so the
  // id always resolves against the pending list.
  const retryQueuedCard = (id: string) => {
    const entry = visiblePending.find((p) => p.localId === id);
    if (entry) onRetry(entry.localId, entry.text);
  };

  return {
    context: { session, canWrite, workspaceId, uploadConfig, resolveAuthor },
    stream: { meta, remint, state, connecting, empty, replaySettled, working },
    thread: {
      threadItems,
      threadPending,
      pinPending,
      onRetry,
      retryTask,
      artifactsByFileId,
      toolDecisions,
    },
    composer: { queueCards, retryQueuedCard, onSend, stopping, onStop, sendError },
    credits: { pausedNoCredits, pausedReason, onResume, resuming },
  };
}
