'use client';

import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { OrganizationId } from '@/lib/tenant-id';
import { reduceSessionActivity } from '../lib/session-activity-machine';
import { type SidebarActivity, sidebarActivityReducer } from '../lib/sidebar-activity-machine';
import type { ChatEvent, WorkspaceSessionListItem } from '../types';
import { sessionQueryKeys } from './keys';
import type { SessionsPage } from './use-session-list';

type Cache = InfiniteData<SessionsPage, string | null>;
type Status = WorkspaceSessionListItem['status'];

// Client-owned dispatch activity is separate from server status, so a delayed
// requires_input echo or list refetch cannot repaint an executing tool yellow.
export const sessionDispatchKeys = {
  workspace: (organizationId: OrganizationId) =>
    [...sessionQueryKeys.all(organizationId), 'dispatch-activity'] as const,
};

export function setSessionDispatchExecuting(
  queryClient: QueryClient,
  organizationId: OrganizationId,
  sessionId: string,
  executing: boolean,
): void {
  queryClient.setQueryData<Readonly<Record<string, boolean>>>(
    sessionDispatchKeys.workspace(organizationId),
    (previous = {}) => {
      if (Boolean(previous[sessionId]) === executing) return previous;
      const next = { ...previous };
      if (executing) next[sessionId] = true;
      else delete next[sessionId];
      return next;
    },
  );
}

export function sessionDisplayStatus(status: Status, dispatchExecuting: boolean): Status {
  return status === 'requires_input' && dispatchExecuting ? 'running' : status;
}

// Only the local send boundary needs an ordering marker: a cursorless replay
// can still end at the PREVIOUS turn while POST /send is in flight.
const localSends = new WeakMap<QueryClient, Map<string, SidebarActivity>>();

export function beginSessionActivity(queryClient: QueryClient, sessionId: string): () => void {
  const previousStatus = cachedSessionStatus(queryClient, sessionId);
  if (previousStatus === 'running' || previousStatus === 'rescheduling') return () => {};
  let sends = localSends.get(queryClient);
  if (!sends) {
    sends = new Map();
    localSends.set(queryClient, sends);
  }
  const startedAt = Date.now();
  updateSessionActivity(queryClient, sessionId, 'running', true);
  sends.set(
    sessionId,
    sidebarActivityReducer(sends.get(sessionId) ?? { kind: 'idle' }, { type: 'start', startedAt }),
  );
  return () => {
    // A newer live event wins over a failed optimistic submission.
    const current = sends.get(sessionId);
    if (current?.kind === 'sending' && current.startedAt === startedAt) {
      sends.delete(sessionId);
      if (previousStatus !== null)
        updateSessionActivity(queryClient, sessionId, previousStatus, true, { force: true });
      else void queryClient.invalidateQueries({ queryKey: sessionQueryKeys.root });
    }
  };
}

/** Own the entire local submission, including attachment preparation. */
export async function runWithSessionActivity<T>(
  queryClient: QueryClient,
  sessionId: string,
  submit: () => Promise<T>,
): Promise<T> {
  const rollback = beginSessionActivity(queryClient, sessionId);
  try {
    return await submit();
  } catch (error) {
    rollback();
    throw error;
  }
}

/** A refetch started during POST /send can still contain the previous idle. */
export function preservePendingSessionSends(
  queryClient: QueryClient,
  page: SessionsPage,
): SessionsPage {
  const sends = localSends.get(queryClient);
  if (!sends?.size) return page;
  return {
    ...page,
    items: page.items.map((item) => {
      const activity = sends.get(item.id);
      const startedAt = activity?.kind === 'sending' ? activity.startedAt : undefined;
      return startedAt === undefined
        ? item
        : { ...item, status: 'running', unread: false, lastEventAt: new Date(startedAt) };
    }),
  };
}

export function sessionStatus(status: string, stopReason?: string): Status | null {
  switch (status) {
    case 'idle':
      return stopReason === 'requires_action' ? 'requires_input' : 'idle';
    case 'rescheduled':
      return 'rescheduling';
    case 'running':
    case 'rescheduling':
    case 'requires_input':
    case 'paused_no_credits':
    case 'terminated':
      return status;
    default:
      return null;
  }
}

function sessionLists(queryClient: QueryClient) {
  return queryClient.getQueriesData<Cache>({
    queryKey: sessionQueryKeys.root,
    predicate: (query) => query.queryKey.length === 3 && query.queryKey[2] === 'list',
  });
}

export function cachedSessionStatus(queryClient: QueryClient, sessionId: string): Status | null {
  for (const [, cache] of sessionLists(queryClient)) {
    const row = cache?.pages.flatMap((page) => page.items).find((item) => item.id === sessionId);
    if (row) return row.status;
  }
  return null;
}

/** A local send and the chat's SSE update the very same rows the sidebar renders.
 * Only existing, authorized list entries are patched; no cross-workspace rows
 * are created. Cancel older reads so they cannot undo a newer live event. */
export function updateSessionActivity(
  queryClient: QueryClient,
  sessionId: string,
  status: Status,
  active: boolean,
  options: { force?: boolean } = {},
): void {
  // Ignore stale idle events while a local send is pending. Running or terminal events clear that
  // marker; rollback may force the genuine prior status.
  const activity = localSends.get(queryClient)?.get(sessionId) ?? { kind: 'idle' };
  const settled = sidebarActivityReducer(activity, {
    type: 'settle',
    status,
    force: options.force === true,
  });
  if (settled.kind === 'sending') return;
  localSends.get(queryClient)?.delete(sessionId);
  for (const [queryKey, cache] of sessionLists(queryClient)) {
    if (!cache?.pages.some((page) => page.items.some((item) => item.id === sessionId))) continue;
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<Cache>(queryKey, (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((row) =>
                row.id === sessionId
                  ? {
                      ...row,
                      ...reduceSessionActivity(row, { status, active }),
                      lastEventAt: row.status === status ? row.lastEventAt : new Date(),
                    }
                  : row,
              ),
            })),
          }
        : old,
    );
  }
}

export function applySessionChatEvent(
  queryClient: QueryClient,
  sessionId: string,
  event: ChatEvent,
  active: boolean,
  replay = false,
): void {
  if (event.kind !== 'status') return;
  // A cursorless attach may replay the previous idle after a new local send.
  // It must not unlock that turn before its new running event arrives.
  const currentStatus = cachedSessionStatus(queryClient, sessionId);
  if (currentStatus === 'paused_no_credits' || currentStatus === 'terminated') return;
  if (replay) {
    if (localSends.get(queryClient)?.get(sessionId)?.kind === 'sending') return;
    for (const [, cached] of sessionLists(queryClient)) {
      const row = cached?.pages.flatMap((page) => page.items).find((item) => item.id === sessionId);
      if (
        row?.lastEventAt &&
        (!event.at || Date.parse(event.at) <= new Date(row.lastEventAt).getTime())
      )
        return;
    }
  }
  const status = sessionStatus(event.status, event.stopReason);
  if (status)
    updateSessionActivity(queryClient, sessionId, status, active, {
      force: false,
    });
}
