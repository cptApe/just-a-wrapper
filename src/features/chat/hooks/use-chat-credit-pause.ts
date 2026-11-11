'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
// Import directly because the realtime barrel includes server-only code.
import { useWorkspaceChannel } from '@/features/realtime/hooks/use-workspace-channel';
import type { ChatEvent, SessionLiveState } from '@/features/sessions';
import { useAsyncAction } from '@/hooks/use-async-action';
import { CREDITS_EXHAUSTED_MESSAGE } from '@/lib/credits-copy';
import { AppError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { chatQueryKeys } from '../api/keys';
import { loadChatStatus } from '../api/load-chat-status';
import type { ChatState } from '../lib/chat-state';
import { workspaceStatusEvent } from '../lib/chat-store';
import type { EventStream } from './use-event-stream';

export function useChatCreditPause({
  initialStatus,
  foldEvent,
  organizationId,
  userId,
  sessionId,
  state,
  remint,
  status,
}: {
  initialStatus: SessionLiveState | null | undefined;
  foldEvent: (event: ChatEvent & { pausedReason?: ChatState['pausedReason'] }) => void;
  organizationId: string | undefined;
  userId: string | undefined;
  sessionId: string;
  state: ChatState;
  remint: () => void;
  status: EventStream['status'];
}) {
  const queryClient = useQueryClient();
  const pausedNoCredits = state.status === 'paused_no_credits';
  const pausedReason = pausedNoCredits ? state.pausedReason : null;
  const statusQuery = useQuery({
    queryKey: chatQueryKeys.status(sessionId),
    queryFn: () => loadChatStatus(sessionId),
    enabled: pausedNoCredits,
    refetchInterval: pausedNoCredits ? 5000 : false,
  });
  useEffect(() => {
    if (!pausedNoCredits) queryClient.removeQueries({ queryKey: chatQueryKeys.status(sessionId) });
  }, [pausedNoCredits, queryClient, sessionId]);
  useEffect(() => {
    const latest = statusQuery.data;
    if (pausedNoCredits && latest && latest.status !== 'paused_no_credits') {
      foldEvent({ ...workspaceStatusEvent(latest.status), pausedReason: latest.pausedReason });
      queryClient.removeQueries({ queryKey: chatQueryKeys.status(sessionId) });
      remint();
    }
  }, [statusQuery.data, foldEvent, remint, pausedNoCredits, queryClient, sessionId]);
  useEffect(() => {
    if (statusQuery.error)
      captureException(statusQuery.error, { sessionId, op: 'poll-credit-pause' });
  }, [statusQuery.error, sessionId]);
  useEffect(() => {
    if (initialStatus)
      foldEvent({
        ...workspaceStatusEvent(initialStatus.status),
        pausedReason: initialStatus.pausedReason,
      });
  }, [initialStatus, foldEvent]);
  useWorkspaceChannel(organizationId ?? null, userId ?? null, (event) => {
    if (event.type !== 'session_status' || event.sessionId !== sessionId) return;
    foldEvent({
      ...workspaceStatusEvent(event.status),
      pausedReason: event.pausedReason ?? null,
    });
    if (
      event.status !== 'paused_no_credits' &&
      (pausedNoCredits || (event.status === 'running' && status === 'done'))
    )
      remint();
  });

  // Explicit Resume handles tasks outside the auto-resume window.
  // A 402 means credits are still exhausted.
  const request = useAsyncAction();
  const onResume = () =>
    request.run(async () => {
      try {
        const { resumed } = z.object({ resumed: z.boolean() }).parse(
          await fetchJson(`/api/sessions/${sessionId}/resume`, {
            method: 'POST',
            signal: AbortSignal.timeout(30_000),
          }),
        );
        if (!resumed) {
          toast.error('This task is still paused. Check your credit limit or try again.');
          return;
        }
        remint();
        // The realtime `running` event clears the banner + re-attaches; nothing
        // else to do here.
      } catch (error) {
        // Show exhausted credits plainly on 402 without error capture.
        if (error instanceof AppError && error.context.status === 402) {
          toast.error(CREDITS_EXHAUSTED_MESSAGE);
          return;
        }
        captureException(error, { sessionId, op: 'resume-session' });
        toast.error('Couldn’t resume the task. Try again.');
      }
    });

  return { pausedNoCredits, pausedReason, onResume, resuming: request.pending };
}
