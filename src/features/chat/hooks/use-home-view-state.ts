'use client';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useOrganizationId, useViewer } from '@/components/providers/app-providers';
import type { AgentTier } from '@/features/agents';
import type { WorkspaceSessionDetail } from '@/features/sessions';
import { useCreateSession } from '@/features/sessions/api/use-create-session';
import type { HomeBilling } from '../components/home-credits-popover';
import type { AttachContext } from '../lib/attachments';
import { onHomeNewTaskRequest } from '../lib/composer-focus';
import type { ComposerHandle } from '../lib/composer-submission';
import { homeFrameFor } from '../lib/home-frame';
import { type HomeOpeningState, reduceHomeOpening } from '../lib/home-opening-machine';
import { useComposerDrop } from './use-composer-drop';
import { useHomeSend } from './use-home-send';
import { useMachineStore } from './use-machine-store';
import { useMessageAttachmentPreviews } from './use-message-attachment-previews';

export function useHomeViewState({
  billing,
  attach,
}: {
  billing: HomeBilling | null;
  attach: AttachContext;
}) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const viewer = useViewer();
  const organizationId = useOrganizationId();
  const [openedSessions, setOpenedSessions] = useState<Record<string, WorkspaceSessionDetail>>({});
  const taskId = pathname.startsWith('/app/task/') ? pathname.split('/')[3] : undefined;
  const openedSession = taskId ? openedSessions[taskId] : undefined;
  const createSession = useCreateSession();
  const initialCredits = billing
    ? {
        kind: 'ready' as const,
        creditBalance: billing.creditBalance,
        hasPlan: billing.isSubscribed,
      }
    : { kind: 'off' as const };
  const composerRef = useRef<ComposerHandle>(null);
  const [tier, setTier] = useState<AgentTier>('default');
  const openingMachine = useMachineStore<HomeOpeningState, Parameters<typeof reduceHomeOpening>[1]>(
    { kind: 'idle' },
    reduceHomeOpening,
  );
  const { state, dispatch } = openingMachine;
  const pending = state.kind === 'creating' ? state.text : null;
  const pendingAttachments = state.kind === 'creating' ? state.attachments : [];
  const openingSessionId =
    state.kind === 'creating' || state.kind === 'opened' ? state.sessionId : null;
  const createError = state.kind === 'failed' ? state.message : null;
  const ownAttachmentPreviews = useMessageAttachmentPreviews();
  const pendingComposerRef = useRef<ComposerHandle>(null);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  // The sidebar's New task action. Home stays mounted after a send (the URL
  // moves to the task with a raw history push and the chat renders in place),
  // and a link back to /app does not re-render this component. So New task
  // asks Home to reset itself: drop the opening in progress, put the URL back
  // on /app, and focus the empty composer. A create still in flight finishes
  // in the background; the attempt token keeps its callbacks from touching
  // this page again.
  useEffect(
    () =>
      onHomeNewTaskRequest((event) => {
        event.preventDefault();
        dispatch({ type: 'reset' });
        if (window.location.pathname !== '/app') window.history.pushState(null, '', '/app');
        requestAnimationFrame(() => composerRef.current?.focus());
      }),
    [dispatch],
  );

  const { onSend } = useHomeSend({
    opening: openingMachine,
    lifetime,
    ownAttachmentPreviews,
    setOpenedSessions,
    tier,
    viewer,
    createSession,
    queryClient,
    attach,
  });
  const drop = useComposerDrop(true, (files) => {
    const composer = pending !== null ? pendingComposerRef.current : composerRef.current;
    composer?.addFiles(files);
  });

  // Replace the full Home surface with the task loading frame on send.
  // The pending composer keeps an editable draft for the opened task.
  const frame = homeFrameFor({
    taskId,
    openedSession: Boolean(openedSession),
    pending: pending !== null,
    openingSessionId,
    routerPath: pathname,
    locationPath: typeof window === 'undefined' ? pathname : window.location.pathname,
  });

  return {
    navigation: { frame, taskId, openedSession, organizationId, viewer },
    opening: { pending, pendingAttachments, pendingComposerRef },
    composer: { initialCredits, tier, setTier, onSend, composerRef, createError },
    drop: { pageDragProps: drop.props, pageDragActive: drop.active },
  };
}
