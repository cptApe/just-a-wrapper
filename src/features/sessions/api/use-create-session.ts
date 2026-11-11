'use client';

import {
  type InfiniteData,
  useMutation,
  useMutationState,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { z } from 'zod';
import { useOrganizationId, useViewer, type Viewer } from '@/components/providers/app-providers';
import type { AgentTier } from '@/features/agents';
import { CREDITS_EXHAUSTED_MESSAGE } from '@/lib/credits-copy';
import { AppError, BillingError } from '@/lib/errors';
import { captureException } from '@/lib/observability-client';
import { sessionListItemSchema } from '../lib/session-list-item-schema';
import { UNTITLED_SESSION_TITLE } from '../lib/untitled-session-title';
import type { WorkspaceSessionListItem } from '../types';
import { scheduleSessionListInvalidate } from './invalidate';
import { sessionQueryKeys } from './keys';
import { insertRowAtTop, removeRow, replaceCreatedRow } from './session-list-cache';
import type { SessionsPage } from './use-session-list';

// Home inserts a provisional row into the list cache before posting. Mutation
// state keeps that row visible through refetches; success replaces it with the
// real id before navigation. Failure removes only its own provisional row.

type InfiniteSessions = InfiniteData<SessionsPage, string | null>;

const CreateResponseSchema = z.object({ sessionId: z.string().min(1) });

// Every session-route refusal shares one wire shape (sessionRouteErrorResponse):
// the two 402 gates and the 503 upstream-failure mapping all carry actionable
// copy in `message`; the rest carry only a code.
const ErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    reason: z.string().optional().catch(undefined),
  }),
});

/** The parsed `{ error }` body of a non-2xx response, or null when it has none. */
async function readErrorBody(
  res: Response,
): Promise<{ code: string; message?: string; reason?: string } | null> {
  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch (error) {
    // A non-JSON error body (proxy or edge failure) can still be refused
    // accurately by status alone; the parse failure itself is worth reporting.
    captureException(error, { op: 'create-session-error-parse', status: res.status });
  }
  const body = ErrorBodySchema.safeParse(raw);
  return body.success ? body.data.error : null;
}

type CreateVars = {
  message: string;
  tier: AgentTier;
  deferMessage?: boolean;
};
const createContextSchema = z.object({ row: sessionListItemSchema });
type CreateContext = z.infer<typeof createContextSchema>;

const createKey = (organizationId: string) => [...sessionQueryKeys.all(organizationId), 'create'];

export function usePendingSessionCreates(organizationId: string) {
  // Select the stored context, not a parsed copy: useMutationState re-renders on every new
  // reference, and each render of a pending mutation's owner notifies the mutation cache.
  const contexts = useMutationState({
    filters: { mutationKey: createKey(organizationId), status: 'pending', exact: true },
    select: (mutation) => mutation.state.context,
  });
  // This exact key is owned by useCreateSession, whose onMutate returns CreateContext.
  return useMemo(
    () => contexts.flatMap((context) => createContextSchema.safeParse(context).data?.row ?? []),
    [contexts],
  );
}

/** Prefix of a provisional sidebar row's id, held until the server assigns the real id. */
const PENDING_SESSION_PREFIX = 'pending-';

/** True for the provisional row a Home send paints before the server answers.
 * The sidebar highlights it as the open chat: the person is already in it. */
export function isPendingSessionId(id: string): boolean {
  return id.startsWith(PENDING_SESSION_PREFIX);
}

function optimisticRow(localId: string, viewer: Viewer): WorkspaceSessionListItem {
  const now = new Date();
  return {
    id: localId,
    title: UNTITLED_SESSION_TITLE,
    status: 'running',
    favoritedAt: null,
    lastEventAt: now,
    createdAt: now,
    unread: false,
    visibility: 'private',
    createdByUserId: viewer.id,
    createdBy: { name: viewer.name ?? viewer.email, email: viewer.email, image: viewer.image },
  };
}

async function postSession(
  vars: CreateVars,
  expectedOrganizationId: string,
): Promise<{ sessionId: string }> {
  // eslint-disable-next-line no-restricted-syntax -- typed credits gate: res.status === 402 maps to BillingError('CREDITS_EXHAUSTED'), which home-view discriminates on
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedOrganizationId,
      message: vars.message,
      tier: vars.tier,
      deferMessage: vars.deferMessage,
    }),
  });
  if (res.status === 402) {
    // Credits and plan limits both return 402. Their codes select different composer banners; preserve
    // the server sentence that names the plan limit.
    const gate = await readErrorBody(res);
    if (gate?.code === 'PLAN_LIMIT_REACHED' && gate.message) {
      throw new BillingError('PLAN_LIMIT_REACHED', gate.message, {
        status: 402,
        expectedState: true,
      });
    }
    // home-view routes this typed error to the composer banner, discriminating
    // on the CREDITS_EXHAUSTED code.
    throw new BillingError('CREDITS_EXHAUSTED', gate?.message ?? CREDITS_EXHAUSTED_MESSAGE, {
      status: 402,
      expectedState: true,
      serverReason: gate?.reason,
    });
  }
  if (!res.ok) {
    // The server's code and sentence ride along in the same context fields
    // fetch-json.ts uses, so home-view can tell an Anthropic outage (a 503 with
    // a plain `message`) from a code bug and show the sentence inline.
    const failure = await readErrorBody(res);
    throw new AppError('API_REQUEST_FAILED', `Could not start the task (HTTP ${res.status}).`, {
      status: res.status,
      url: '/api/sessions',
      expectedState: failure?.code === 'WORKSPACE_CHANGED',
      serverCode: failure?.code,
      serverMessage: failure?.message,
    });
  }
  return CreateResponseSchema.parse(await res.json());
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId();
  const viewer = useViewer();
  const root = organizationId ? sessionQueryKeys.all(organizationId) : null;
  const listKey = organizationId ? sessionQueryKeys.list(organizationId) : null;

  return useMutation({
    mutationKey: createKey(organizationId ?? ''),
    mutationFn: (vars: CreateVars) => {
      if (!organizationId) throw new AppError('WORKSPACE_NOT_FOUND', 'No workspace selected');
      return postSession(vars, organizationId);
    },
    onMutate: async (): Promise<CreateContext | undefined> => {
      // No viewer means this hook is mounted outside the (shell) subtree — the
      // optimistic row can't be shaped accurately, so skip it (the terminal
      // invalidate still paints the real server row).
      if (!root || !listKey || !viewer) return undefined;
      await queryClient.cancelQueries({ queryKey: root });
      // A provisional row must not open a stream before the server assigns its id.
      const localId = `${PENDING_SESSION_PREFIX}${crypto.randomUUID()}`;
      const row = optimisticRow(localId, viewer);
      queryClient.setQueryData<InfiniteSessions>(listKey, (old) => insertRowAtTop(old, row));
      return { row };
    },
    onSuccess: async (data, _vars, context) => {
      if (!listKey || !context) return;
      // A list started before create persisted must not erase the real row.
      await queryClient.cancelQueries({ queryKey: listKey });
      // Attach the real id so the row links to the task and the terminal
      // invalidate reconciles it against the server row (matched by id).
      queryClient.setQueryData<InfiniteSessions>(listKey, (old) =>
        replaceCreatedRow(old, context.row, data.sessionId),
      );
    },
    onError: (_error, _vars, context) => {
      // Remove only this create, preserving concurrent edits and other creates.
      if (listKey && context) {
        queryClient.setQueryData<InfiniteSessions>(listKey, (old) =>
          removeRow(old, context.row.id),
        );
      }
    },
    onSettled: () => {
      // Debounce create completion with realtime status/title invalidations so one creation does not
      // trigger competing list refetches.
      if (organizationId) scheduleSessionListInvalidate(queryClient, organizationId);
    },
  });
}
