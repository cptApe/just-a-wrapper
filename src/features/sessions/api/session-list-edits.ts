import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { type OptimisticEditState, reduceOptimisticEdit } from '../lib/optimistic-edit-machine';
import type { WorkspaceSessionListItem } from '../types';
import { sessionQueryKeys } from './keys';
import { patchRow, removeRow } from './session-list-cache';
import type { SessionsPage } from './use-session-list';

type InfiniteSessions = InfiniteData<SessionsPage, string | null>;

export type RollbackContext = { rollback: () => void; release: () => void };
// Shared across hook instances, scoped to the client and field. A later edit
// supersedes an earlier rollback even if both edits write the same value.
const pendingRollbacks = new WeakMap<QueryClient, Map<string, () => void>>();

function guardRollback(
  queryClient: QueryClient,
  organizationId: string,
  sessionId: string,
  field: 'title' | 'favoritedAt' | 'delete',
  unchanged: (cache: InfiniteSessions | undefined) => boolean,
  restore: (cache: InfiniteSessions) => InfiniteSessions,
): RollbackContext {
  const listKey = sessionQueryKeys.list(organizationId);
  let guards = pendingRollbacks.get(queryClient);
  if (!guards) {
    guards = new Map();
    pendingRollbacks.set(queryClient, guards);
  }
  const key = JSON.stringify([organizationId, sessionId, field]);
  guards.get(key)?.();
  let state: OptimisticEditState = { phase: 'applied' };
  const supersede = () => {
    state = reduceOptimisticEdit(state, 'supersede');
  };
  guards.set(key, supersede);
  const query = queryClient.getQueryCache().find({ queryKey: listKey, exact: true });
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.query !== query) return;
    // Remember intervening changes, including a value changing away and back.
    if (event.type === 'removed' || !unchanged(queryClient.getQueryData(listKey))) {
      supersede();
    }
    // A server list fetched after a delete is newer evidence of membership.
    if (
      field === 'delete' &&
      event.type === 'updated' &&
      event.action.type === 'success' &&
      !event.action.manual
    )
      supersede();
  });
  const cleanup = () => {
    unsubscribe();
    if (guards.get(key) === supersede) guards.delete(key);
  };
  return {
    release: () => {
      state = reduceOptimisticEdit(state, 'release');
      cleanup();
    },
    rollback: () => {
      cleanup();
      if (state.phase !== 'applied') return;
      state = reduceOptimisticEdit(state, 'rollback');
      queryClient.setQueryData<InfiniteSessions>(listKey, (old) =>
        old && unchanged(old) ? restore(old) : old,
      );
    },
  };
}

export async function beginField<K extends 'title' | 'favoritedAt'>(
  queryClient: QueryClient,
  organizationId: string,
  sessionId: string,
  field: K,
  value: WorkspaceSessionListItem[K],
): Promise<RollbackContext | null> {
  const listKey = sessionQueryKeys.list(organizationId);
  await queryClient.cancelQueries({ queryKey: sessionQueryKeys.all(organizationId) });
  const row = queryClient
    .getQueryData<InfiniteSessions>(listKey)
    ?.pages.flatMap((page) => page.items)
    .find((item) => item.id === sessionId);
  if (!row) return null;
  const previous = row[field];
  queryClient.setQueryData<InfiniteSessions>(listKey, (old) =>
    patchRow(old, sessionId, { [field]: value }),
  );
  return guardRollback(
    queryClient,
    organizationId,
    sessionId,
    field,
    (cache) =>
      cache?.pages.flatMap((page) => page.items).find((item) => item.id === sessionId)?.[field] ===
      value,
    (cache) => patchRow(cache, sessionId, { [field]: previous }) ?? cache,
  );
}

export async function beginDelete(
  queryClient: QueryClient,
  organizationId: string,
  sessionId: string,
): Promise<RollbackContext | null> {
  const listKey = sessionQueryKeys.list(organizationId);
  await queryClient.cancelQueries({ queryKey: sessionQueryKeys.all(organizationId) });
  // A repeated delete can start after the first already hid the row.
  pendingRollbacks.get(queryClient)?.get(JSON.stringify([organizationId, sessionId, 'delete']))?.();
  const cache = queryClient.getQueryData<InfiniteSessions>(listKey);
  const pageIndex =
    cache?.pages.findIndex((page) => page.items.some((row) => row.id === sessionId)) ?? -1;
  const page = cache?.pages[pageIndex];
  const index = page?.items.findIndex((row) => row.id === sessionId) ?? -1;
  const row = page?.items[index];
  if (!cache || !row) return null;
  const pageParam = cache.pageParams[pageIndex];
  queryClient.setQueryData<InfiniteSessions>(listKey, (old) => removeRow(old, sessionId));
  return guardRollback(
    queryClient,
    organizationId,
    sessionId,
    'delete',
    (old) => !!old && !old.pages.some((page) => page.items.some((item) => item.id === sessionId)),
    (old) => ({
      ...old,
      pages: old.pages.map((page, i) => {
        if (old.pageParams[i] !== pageParam) return page;
        const items = [...page.items];
        items.splice(Math.min(index, items.length), 0, row);
        return { ...page, items };
      }),
    }),
  );
}
