import type { InfiniteData } from '@tanstack/react-query';
import type { WorkspaceSessionListItem } from '../types';
import type { SessionsPage } from './use-session-list';

// All optimistic mutations update the same paginated query cache; a second row store could
// disagree with live refetches.
type Cache = InfiniteData<SessionsPage, string | null>;

/** Insert a row at the very top of the first page (newest-first placement). */
export function insertRowAtTop(cache: Cache | undefined, row: WorkspaceSessionListItem): Cache {
  const pages = removeRow(cache, row.id)?.pages ?? [{ items: [], nextCursor: null }];
  const pageParams = cache?.pageParams ?? [null];
  const first = pages.at(0);
  const rest = pages.slice(1);
  const head: SessionsPage = {
    items: [row, ...(first?.items ?? [])],
    nextCursor: first?.nextCursor ?? null,
  };
  return { pages: [head, ...rest], pageParams };
}

/** Patch the row with `id` wherever it lives across the loaded pages. */
export function patchRow(
  cache: Cache | undefined,
  id: string,
  patch: Partial<WorkspaceSessionListItem>,
): Cache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    pages: cache.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })),
  };
}

/** Reconcile a create even if a refetch removed its provisional row. */
// Keep the provisional React key after server creation so replacing the ID does not remount the
// row or restart its spinner.
const createdRowKeys = new Map<string, string>();

/** The React key for a sidebar row: the pending id it was born under, else its id. */
export function sessionRowKey(sessionId: string): string {
  return createdRowKeys.get(sessionId) ?? sessionId;
}

export function replaceCreatedRow(
  cache: Cache | undefined,
  pending: WorkspaceSessionListItem,
  sessionId: string,
): Cache {
  createdRowKeys.set(sessionId, pending.id);
  // Keys outlive one render but never grow with the entire account history.
  if (createdRowKeys.size > 500) {
    const oldest = createdRowKeys.keys().next().value;
    if (oldest) createdRowKeys.delete(oldest);
  }
  const serverRow = cache?.pages.flatMap((page) => page.items).find((row) => row.id === sessionId);
  const withoutPending = removeRow(cache, pending.id);
  // Preserve an early generated title or status already received from the server.
  return insertRowAtTop(withoutPending, serverRow ?? { ...pending, id: sessionId });
}

/** Pending mutations survive a list refetch without a second state store. */
export function mergePendingSessionRows(
  items: WorkspaceSessionListItem[],
  pending: WorkspaceSessionListItem[],
): WorkspaceSessionListItem[] {
  const ids = new Set(items.map((row) => row.id));
  return [...pending.filter((row) => !ids.has(row.id)), ...items];
}

/** Drop the row with `id` from every loaded page (soft-delete / rollback). */
export function removeRow(cache: Cache | undefined, id: string): Cache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    pages: cache.pages.map((page) => ({
      ...page,
      items: page.items.filter((item) => item.id !== id),
    })),
  };
}
