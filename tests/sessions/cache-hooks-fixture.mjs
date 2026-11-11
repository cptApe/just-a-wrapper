/** Browser fixture: real React hooks/cache, controlled HTTP and telemetry boundaries. */

import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import React, { useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { discardDraft } from '@/features/chat/lib/draft-store';
import { useSearchResults } from '@/features/search/api/use-search-results';
import { sessionQueryKeys } from '@/features/sessions/api/keys';
import { patchRow } from '@/features/sessions/api/session-list-cache';
import { updateSessionActivity } from '@/features/sessions/api/session-live-cache';
import { useSessionMutations } from '@/features/sessions/api/use-session-mutations';
import { searchQueryKeys } from '@/lib/search-query-keys';

const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
    mutations: { retry: false },
  },
});
const listKey = sessionQueryKeys.list('workspace');
const requests = [];
const row = (id) => ({
  id,
  title: `Client ${id}`,
  status: 'idle',
  favoritedAt: null,
  unread: false,
  createdAt: new Date('2026-09-01'),
  lastEventAt: null,
  visibility: 'private',
  createdByUserId: 'user',
  createdBy: { name: 'Test', email: 'test@example.com', image: null },
});
client.setQueryData(listKey, {
  pages: [
    { items: [row('a'), row('b')], nextCursor: 'older' },
    { items: [row('c')], nextCursor: null },
  ],
  pageParams: [null, 'older'],
});
let serverResults = [
  { group: 'task', id: 'older', title: 'Client history', href: '/app/task/older' },
];
let searchCalls = 0;
let searchError = false;
window.fetch = async (url, init = {}) => {
  if (url.startsWith('/api/search?')) {
    searchCalls++;
    return Response.json(
      searchError ? { error: 'Search unavailable' } : { results: serverResults },
      { status: searchError ? 503 : 200 },
    );
  }
  return new Promise((resolve) =>
    requests.push({ url, body: init.body, method: init.method, resolve }),
  );
};
const h = (window.harness = {
  client,
  QueryObserver,
  listKey,
  requests,
  searchQueryKeys,
  rows: () => client.getQueryData(listKey)?.pages.flatMap((page) => page.items),
  live: (id, status) => updateSessionActivity(client, id, status, false),
  patch: (id, fields) => client.setQueryData(listKey, (old) => patchRow(old, id, fields)),
  respond: (index, status) => requests[index].resolve(new Response(null, { status })),
  setResults: (results) => {
    serverResults = results;
  },
  setSearchError: (value) => {
    searchError = value;
  },
  searchCalls: () => searchCalls,
});
function Harness() {
  const [search, setSearch] = useState({ query: '', open: false });
  const mutations = useSessionMutations('workspace', discardDraft);
  const otherMutations = useSessionMutations('workspace', discardDraft);
  const results = useSearchResults(search.query, search.open);
  useLayoutEffect(() => {
    h.mutations = mutations;
    h.otherMutations = otherMutations;
    h.search = results;
    h.setSearch = (query, open) => flushSync(() => setSearch({ query, open }));
  });
  return React.createElement('pre', null, JSON.stringify(results.state));
}
const root = createRoot(document.getElementById('root'));
flushSync(() =>
  root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Harness))),
);
