import 'server-only';
import { getAnthropicClient } from '@/features/agents';
// Search needs flat notes and store resolution, not the Library surface exposed by the memory barrel.
import { listNotesPage } from '@/features/memory/api/notes';
import { resolveMemoryContext } from '@/features/memory/api/resolve';
import { buildOverlayHash } from '@/features/overlays/lib/hash';
import { captureException } from '@/lib/observability';
import { MEMORY_SEARCH_LIMIT } from '../constants';
import { normalizeQuery } from '../lib/match';
import { matchNotesByPath, noteLocation } from '../lib/match-notes';
import type { ServerSearchResult } from '../types';

/**
 * Every note in the caller's personal and workspace stores whose path holds the query, up to
 * `limit`. Stores are resolved from the caller's session; an unprovisioned or failing store
 * contributes no results while the other stays visible.
 */
export async function searchMemoryNotes(input: {
  headers: Headers;
  query: string;
  limit: number;
}): Promise<ServerSearchResult[]> {
  const client = getAnthropicClient();
  if (!client) return [];
  const ctx = await resolveMemoryContext(input.headers);

  const scopes = [
    { scope: 'you' as const, storeId: ctx.userStoreId, label: 'Your memory' },
    { scope: 'workspace' as const, storeId: ctx.workspaceStoreId, label: 'Workspace memory' },
  ];

  const pages = await Promise.all(
    scopes.map(async (source) => {
      const { scope, storeId, label } = source;
      const [outcome] = await Promise.allSettled([
        (async () => {
          if (!storeId) return [];
          const notes = await matchNotesByPath({
            query: input.query,
            limit: input.limit,
            listPage: (cursor) =>
              listNotesPage(client, storeId, { cursor, pathPrefix: null, depth: null }),
          });
          return notes.map((note) => ({
            group: 'memory' as const,
            id: note.id,
            title: note.path.slice(note.path.lastIndexOf('/') + 1),
            subtitle: noteLocation(label, note.path),
            href: `/app/library?tab=memory&scope=${scope}#${buildOverlayHash('memory', note.id, { scope })}`,
          }));
        })(),
      ] as const);
      return { source, outcome };
    }),
  );

  const results: ServerSearchResult[] = [];
  pages.forEach(({ source, outcome }) => {
    if (outcome.status === 'fulfilled') {
      results.push(...outcome.value);
      return;
    }
    captureException(outcome.reason, {
      feature: 'search',
      domain: 'memory',
      scope: source.scope,
    });
  });
  return results.slice(0, input.limit);
}

/** The Memory pane's search: every note in both stores, a longer list than the command menu's. */
export async function searchMemory(input: {
  headers: Headers;
  query: string;
}): Promise<ServerSearchResult[]> {
  const query = normalizeQuery(input.query);
  if (query === '') return [];
  return searchMemoryNotes({ headers: input.headers, query, limit: MEMORY_SEARCH_LIMIT });
}
