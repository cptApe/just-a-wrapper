'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { captureException } from '@/lib/observability-client';
import { connectIntegration, disconnectIntegration } from '../api/connections';
import {
  readIntegrationStatus,
  statusNotice,
  useIntegrationStatus,
} from '../api/integration-status';
import { shareIntegration, stopSharingIntegration } from '../api/shared-connection-actions';
import { connectionPhase, TIMED_POLLS, waitForSignIn } from '../lib/sign-in-flow';
import type { IntegrationView, TesterNotice } from '../types';

export type IntegrationConnection = ReturnType<typeof useIntegrationConnection>;

// The member's own account and the workspace's shared account run the same sign-in
// lifecycle against different actions. Each finishes on its own side of the view.
const FLOWS = {
  own: {
    start: connectIntegration,
    stop: disconnectIntegration,
    isDone: (view: IntegrationView) => view.ownConnected,
  },
  workspace: {
    start: shareIntegration,
    stop: stopSharingIntegration,
    isDone: (view: IntegrationView) => view.shared.status === 'active',
  },
} as const;

function showNotice(notice: TesterNotice | null) {
  if (notice === null) return;
  const show = notice.tone === 'error' ? toast.error : toast.warning;
  show(notice.title, { description: notice.body });
}

// Starting, waiting for sign-in, checking and stopping are mutations; the status they read is the
// shared status query. Results arrive through mutate callbacks, so a closed panel shows nothing.
export function useIntegrationConnection(slug: string, flowName: keyof typeof FLOWS) {
  const flow = FLOWS[flowName];
  const queryClient = useQueryClient();
  const { organizationId, query } = useIntegrationStatus(slug);
  const read = () => readIntegrationStatus(queryClient, organizationId, slug);
  const waiting = useRef<AbortController | null>(null);
  // When the last action settled: a status failure older than it was already answered by a toast.
  const [settledAt, setSettledAt] = useState(0);
  useEffect(() => () => waiting.current?.abort(), []);

  const stopWaiting = () => {
    waiting.current?.abort();
    waiting.current = null;
  };
  const settled = () => setSettledAt(Date.now());

  const wait = useMutation({
    mutationFn: ({ polls, signal }: { polls: number; signal: AbortSignal }) =>
      waitForSignIn({ polls, signal, read, isDone: flow.isDone }),
    onSettled: settled,
  });
  const awaitSignIn = (polls: number) => {
    stopWaiting();
    const controller = new AbortController();
    waiting.current = controller;
    wait.mutate(
      { polls, signal: controller.signal },
      {
        onSuccess: ({ notice, aborted }) => {
          if (!aborted) showNotice(notice);
        },
      },
    );
  };

  const connect = useMutation({
    mutationFn: async () => {
      const result = await flow.start(slug);
      if (result.status === 'active') return { ...result, notice: (await read()).notice };
      return result;
    },
    onSettled: settled,
  });
  const disconnect = useMutation({
    mutationFn: async () => {
      const result = await flow.stop(slug);
      if (result.status === 'notice') return result.notice;
      // Removing one side can leave the other in use, so the server says what remains.
      return (await read()).notice;
    },
    onSettled: settled,
  });
  type StatusRead = Awaited<ReturnType<typeof read>>;
  // `resume` marks a check made while waiting for sign-in.
  const check = useMutation<StatusRead, Error, { resume: boolean }>({
    mutationFn: () => read(),
    onSettled: settled,
  });

  // The opening read has no action behind it, so its failure stays on the panel. One flow owns it.
  const opening = flowName === 'own' && query.isFetching && query.data === undefined;
  const phase = connectionPhase({
    connecting: connect.isPending,
    disconnecting: disconnect.isPending,
    checking: check.isPending || opening,
    awaiting: wait.isPending,
  });
  const canStart = phase === 'idle' || phase === 'awaiting';
  const loadFailure =
    flowName === 'own' && phase === 'idle' && query.isError && query.errorUpdatedAt > settledAt
      ? statusNotice(query.error)
      : null;

  return {
    phase,
    signInPending: phase === 'awaiting' || (check.isPending && check.variables.resume),
    loadFailure,
    connect: () => {
      if (!canStart) return;
      stopWaiting();
      connect.mutate(undefined, {
        onSuccess: (result) => {
          if (result.status === 'redirect') {
            window.open(result.redirectUrl, '_blank', 'noopener,noreferrer');
            awaitSignIn(TIMED_POLLS);
          } else showNotice(result.notice);
        },
        onError: (error) => {
          captureException(error, { op: 'connect-integration', slug });
          showNotice({
            tone: 'error',
            title: 'Connect failed',
            body: 'Couldn’t start the connection. Try again.',
          });
        },
      });
    },
    disconnect: () => {
      if (phase !== 'idle') return;
      disconnect.mutate(undefined, {
        onSuccess: showNotice,
        onError: (error) => {
          captureException(error, { op: 'disconnect-integration', slug });
          showNotice({
            tone: 'error',
            title: 'Disconnect failed',
            body: 'Couldn’t remove the connection. Try again.',
          });
        },
      });
    },
    recheck: () => {
      if (!canStart) return;
      const resume = phase === 'awaiting';
      stopWaiting();
      check.mutate(
        { resume },
        {
          onSuccess: ({ view, notice }) => {
            if (notice !== null) showNotice(notice);
            else if (resume && !flow.isDone(view)) awaitSignIn(0);
          },
        },
      );
    },
    reload: () => {
      if (canStart) void query.refetch();
    },
  };
}
