'use client';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import type { ChatEvent } from '@/features/sessions';
import { fetchJson } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { getAlreadyResolvedCustomToolDispatchId } from '../lib/custom-tool-dispatch-retry';
import type { createReducerStore } from '../lib/reducer-store';
import type { GateAnswer } from '../lib/tool-decisions';
import {
  TOOL_ACTION_FAILED_MESSAGE,
  type ToolRequestAction,
  type ToolRequests,
} from '../lib/tool-request-machine';

// The three requests behind tool decisions: answer a relayed gate, run custom tools,
// answer a held custom tool. Each one moves the shared tool-request store.

export const pendingRowsSchema = z.object({
  pending: z.array(z.object({ toolUseId: z.string() })),
});
export type PendingRow = z.infer<typeof pendingRowsSchema>['pending'][number];

const gateOutcomesSchema = z.object({
  outcomes: z.array(
    z.discriminatedUnion('status', [
      z.object({ toolUseId: z.string(), status: z.literal('failed') }),
      z.object({
        toolUseId: z.string(),
        status: z.literal('sent'),
        scopeStatus: z.enum(['remembered', 'failed']).optional(),
      }),
    ]),
  ),
});
const dispatchSchema = z.object({
  outcomes: z.array(
    z.object({
      toolUseId: z.string(),
      name: z.string(),
      status: z.enum(['posted', 'pending', 'retry']),
      detail: z.string().optional(),
    }),
  ),
});
const confirmSchema = z.object({
  outcomes: z.array(
    z.object({
      toolUseId: z.string(),
      status: z.enum(['resolved', 'skipped']),
      detail: z.string().optional(),
    }),
  ),
});

type ToolRequestStore = ReturnType<typeof createReducerStore<ToolRequests, ToolRequestAction>>;

export type ToolDecisionScope = {
  sessionId: string;
  store: ToolRequestStore;
  queryClient: QueryClient;
  /** The custom calls the server holds for confirmation. */
  pendingKey: QueryKey;
  reattach: () => void;
};

export type DispatchCall = { toolUseId: string; name: string };

/** Answer one relayed gate. The local confirmation fold closes the card at once. */
export async function answerBuiltinGate(
  { sessionId, store, reattach }: ToolDecisionScope,
  gate: { toolUseId: string; threadId?: string },
  answer: GateAnswer,
  foldEvent: (event: ChatEvent) => void,
) {
  const { toolUseId, threadId } = gate;
  const attempt = Symbol();
  store.dispatch({ type: 'pending', id: toolUseId });
  store.dispatch({ type: 'confirm', ids: [toolUseId], attempt });
  try {
    const { outcomes } = gateOutcomesSchema.parse(
      await fetchJson(`/api/sessions/${sessionId}/tool-confirmations`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decisions: [
            answer === 'deny'
              ? { toolUseId, result: 'deny', threadId }
              : { toolUseId, result: 'allow', scope: answer, threadId },
          ],
        }),
      }),
    );
    if (outcomes.some((outcome) => outcome.status === 'failed'))
      toast.error(TOOL_ACTION_FAILED_MESSAGE);
    if (outcomes.some((outcome) => outcome.status === 'sent' && outcome.scopeStatus === 'failed'))
      toast.error('Approved this action, but couldn’t remember the permission.');
    if (outcomes.some((outcome) => outcome.status === 'sent' && outcome.toolUseId === toolUseId)) {
      foldEvent({
        id: `confirmation-${toolUseId}`,
        kind: 'tool_confirmation',
        rawType: 'local.tool_confirmation',
        toolUseId,
        result: answer === 'deny' ? 'deny' : 'allow',
      });
      store.dispatch({ type: 'posted', id: toolUseId, attempt });
      // The relay may have closed on its deadline while the gate waited.
      reattach();
    }
  } catch (error) {
    captureException(error, { sessionId, op: 'confirm-tool-gates' });
    toast.error(TOOL_ACTION_FAILED_MESSAGE);
  } finally {
    store.dispatch({ type: 'failed', ids: [toolUseId], attempt, now: Date.now() });
  }
}

/** Answer one custom call the server holds for confirmation. */
export async function answerCustomTool(
  { sessionId, store, queryClient, pendingKey, reattach }: ToolDecisionScope,
  toolUseId: string,
  decision: 'allow' | 'deny',
) {
  const attempt = Symbol();
  store.dispatch({ type: 'confirm', ids: [toolUseId], attempt });
  try {
    const { outcomes } = confirmSchema.parse(
      await fetchJson('/api/custom-tools/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, decisions: [{ toolUseId, decision }] }),
        signal: AbortSignal.timeout(30_000),
      }),
    );
    // NOT_PENDING: another tab or the recovery job already settled it.
    const resolved = outcomes.some(
      (outcome) =>
        outcome.toolUseId === toolUseId &&
        (outcome.status === 'resolved' || outcome.detail === 'NOT_PENDING'),
    );
    if (resolved) {
      store.dispatch({ type: 'posted', id: toolUseId, attempt });
      queryClient.setQueryData<PendingRow[]>(pendingKey, (rows) =>
        rows?.filter((row) => row.toolUseId !== toolUseId),
      );
    } else {
      store.dispatch({ type: 'failed', ids: [toolUseId], attempt, now: Date.now() });
      toast.error('Some actions are still waiting for delivery. Try again.');
    }
    void queryClient.invalidateQueries({ queryKey: pendingKey });
    reattach();
  } catch (error) {
    store.dispatch({ type: 'failed', ids: [toolUseId], attempt, now: Date.now() });
    captureException(error, { sessionId, op: 'confirm-custom-tools' });
    toast.error(TOOL_ACTION_FAILED_MESSAGE);
  }
}

function notifyExhausted(store: ToolRequestStore, ids: string[]) {
  const exhausted = ids.filter((id) => store.getSnapshot().get(id)?.kind === 'exhausted');
  if (exhausted.length)
    toast.error("Couldn't run the agent's tool.", {
      duration: Infinity,
      action: {
        label: 'Retry',
        onClick: () => store.dispatch({ type: 'retry', ids: exhausted }),
      },
    });
}

/** Run custom calls the agent is waiting on; a call the server holds for confirmation becomes a card. */
export async function dispatchCustomCalls(
  { sessionId, store, queryClient, pendingKey, reattach }: ToolDecisionScope,
  calls: DispatchCall[],
  signal: AbortSignal,
) {
  const attempt = Symbol();
  const ids = calls.map((call) => call.toolUseId);
  store.dispatch({ type: 'dispatch', ids, attempt, now: Date.now() });
  try {
    const { outcomes } = dispatchSchema.parse(
      await fetchJson('/api/custom-tools/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, calls }),
        signal,
      }),
    );
    if (signal.aborted) {
      store.dispatch({ type: 'cancel', ids, attempt });
      return;
    }
    for (const { toolUseId: id, status, detail } of outcomes) {
      if (!ids.includes(id)) continue;
      if (status === 'posted') store.dispatch({ type: 'posted', id, attempt });
      else if (status === 'retry')
        store.dispatch(
          detail === 'DELIVERY_PENDING'
            ? { type: 'failed', ids: [id], attempt, now: Date.now() }
            : { type: 'progress', id, attempt, now: Date.now() },
        );
      else {
        store.dispatch({ type: 'pending', id });
        queryClient.setQueryData<PendingRow[]>(pendingKey, (rows) => [
          ...(rows ?? []).filter((row) => row.toolUseId !== id),
          { toolUseId: id },
        ]);
      }
    }
    notifyExhausted(store, ids);
    void queryClient.invalidateQueries({ queryKey: pendingKey });
    if (outcomes.some((outcome) => outcome.status === 'posted')) reattach();
  } catch (error) {
    if (signal.aborted) {
      store.dispatch({ type: 'cancel', ids, attempt });
      return;
    }
    const resolvedId = getAlreadyResolvedCustomToolDispatchId(error);
    if (resolvedId && ids.includes(resolvedId)) {
      store.dispatch({ type: 'posted', id: resolvedId, attempt });
      reattach();
    } else captureException(error, { sessionId, op: 'dispatch-custom-tools' });
    store.dispatch({
      type: 'failed',
      ids: ids.filter((id) => id !== resolvedId),
      attempt,
      now: Date.now(),
    });
    notifyExhausted(store, ids);
  }
}
