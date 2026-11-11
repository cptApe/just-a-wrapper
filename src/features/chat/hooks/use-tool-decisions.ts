'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import type { ChatEvent } from '@/features/sessions';
import { fetchJson } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { customToolsKeys } from '../api/keys';
import {
  answerBuiltinGate,
  answerCustomTool,
  dispatchCustomCalls,
  pendingRowsSchema,
  type ToolDecisionScope,
} from '../api/tool-decision-requests';
import type { ChatState } from '../lib/chat-state';
import { toolsStopped } from '../lib/chat-turns';
import {
  selectActiveAutoDispatchToolUseIds,
  selectCustomToolDispatchCalls,
} from '../lib/custom-tool-dispatch-retry';
import { createReducerStore } from '../lib/reducer-store';
import {
  type GateAnswer,
  samePendingDecisions,
  selectPendingDecisions,
  type ToolDecisions,
} from '../lib/tool-decisions';
import { type ToolRequests, toolRequestReducer } from '../lib/tool-request-machine';

// The one owner of tool decisions. It runs custom tools the agent waits on, reads the
// custom calls the server holds for confirmation, folds in the relayed built-in gates,
// and answers either kind. Components read the result through useToolGate.

function createToolRequestStore() {
  return createReducerStore(new Map() as ToolRequests, toolRequestReducer);
}

function usePendingCustomIds(sessionId: string, state: ChatState, scope: ToolDecisionScope) {
  const organizationId = useOrganizationId();
  const query = useQuery({
    queryKey: scope.pendingKey,
    queryFn: async ({ signal }) =>
      pendingRowsSchema.parse(
        await fetchJson(`/api/custom-tools/pending?sessionId=${encodeURIComponent(sessionId)}`, {
          signal,
        }),
      ).pending,
    enabled: organizationId !== null,
    refetchInterval:
      state.status === 'idle' && state.stopReason === 'requires_action' ? 5000 : false,
  });
  useEffect(() => {
    if (query.error) captureException(query.error, { sessionId, op: 'load-pending-confirmations' });
  }, [query.error, sessionId]);
  const { store } = scope;
  useEffect(() => {
    for (const row of query.data ?? []) store.dispatch({ type: 'pending', id: row.toolUseId });
  }, [query.data, store]);
  return useMemo(() => (query.data ?? []).map((row) => row.toolUseId), [query.data]);
}

function useDispatchReadyCalls(
  scope: ToolDecisionScope,
  state: ChatState,
  replaySettled: boolean,
  requests: ToolRequests,
) {
  const dispatchReady = useEffectEvent(async (signal: AbortSignal) => {
    const calls = selectCustomToolDispatchCalls(
      state,
      replaySettled,
      scope.store.getSnapshot(),
      Date.now(),
    );
    if (calls.length > 0) await dispatchCustomCalls(scope, calls, signal);
  });
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (lifetime.current) void dispatchReady(lifetime.current.signal);
  }, [state.status, state.stopReason, state.items, replaySettled, requests, lifetime]);
  const waiting = [...requests.values()].some((request) => request.kind === 'waiting');
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (lifetime.current) void dispatchReady(lifetime.current.signal);
    }, 500);
    return () => clearInterval(timer);
  }, [waiting, lifetime]);
}

export function useToolDecisions({
  sessionId,
  state,
  replaySettled,
  reattach,
  foldEvent,
  canDecide,
  canSetGlobalPermission,
}: {
  sessionId: string;
  state: ChatState;
  replaySettled: boolean;
  reattach: () => void;
  foldEvent: (event: ChatEvent) => void;
  /** The viewer may answer approvals. */
  canDecide: boolean;
  /** The viewer may turn an approval into their Tools page setting. */
  canSetGlobalPermission: boolean;
}) {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId();
  const [store] = useState(createToolRequestStore);
  const requests = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const scope: ToolDecisionScope = {
    sessionId,
    store,
    queryClient,
    pendingKey:
      organizationId === null
        ? customToolsKeys.pendingUnscoped(sessionId)
        : customToolsKeys.pending(organizationId, sessionId),
    reattach,
  };
  const customPendingIds = usePendingCustomIds(sessionId, state, scope);
  useDispatchReadyCalls(scope, state, replaySettled, requests);

  // Keep the same map while nothing about a decision changed, so memoized turns skip
  // the stream frames that only grow a reply.
  const next = selectPendingDecisions({
    state,
    customPendingIds,
    requests,
    canSetGlobalPermission,
  });
  const [stable, keep] = useState(next);
  const pending = samePendingDecisions(stable, next) ? stable : next;
  if (pending !== stable) keep(pending);

  // Clicks read the latest render through a ref, so the context value stays stable while
  // the stream renders.
  const latest = useRef({ state, pending, scope, foldEvent });
  useEffect(() => {
    latest.current = { state, pending, scope, foldEvent };
  });
  const resolve = useCallback(
    (toolUseId: string, answer: GateAnswer) => {
      const { state, pending, scope, foldEvent } = latest.current;
      const call = pending.get(toolUseId);
      const request = store.getSnapshot().get(toolUseId);
      if (toolsStopped(state) || !call || request?.kind === 'confirming') return;
      if (call.source === 'builtin')
        void answerBuiltinGate(
          scope,
          { toolUseId, ...(call.threadId ? { threadId: call.threadId } : {}) },
          answer,
          foldEvent,
        );
      else if (request?.kind === 'pending')
        void answerCustomTool(scope, toolUseId, answer === 'deny' ? 'deny' : 'allow');
    },
    [store],
  );

  const decisions = useMemo<ToolDecisions>(
    () => ({ pending, canDecide, resolve }),
    [pending, canDecide, resolve],
  );
  const autoDispatchToolUseIds = selectActiveAutoDispatchToolUseIds(
    state.items,
    replaySettled,
    requests,
  );
  return { decisions, autoDispatchToolUseIds };
}
