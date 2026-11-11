/** Browser fixture: the real task header and sidebar list cache, with controlled HTTP and navigation. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatHeader } from '@/features/chat/components/chat-header';
import { readComposerDraft, restoreComposerDraft } from '@/features/chat/lib/draft-store';
import { sessionQueryKeys } from '@/features/sessions/api/keys';

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
  pages: [{ items: [row('a'), row('b')], nextCursor: null }],
  pageParams: [null],
});
restoreComposerDraft('a', {
  text: 'Keep my text',
  attachments: [],
  library: [{ id: 'file' }],
  folders: [],
  skills: [],
});
window.fetch = (url, init = {}) =>
  new Promise((resolve) => requests.push({ url, method: init.method, body: init.body, resolve }));
window.harness = {
  client,
  requests,
  paths: [],
  toasts: [],
  draft: () => readComposerDraft('a').text,
  takePicks: () => {
    const draft = readComposerDraft('a');
    return draft.library.length > 0 ? draft : undefined;
  },
  rows: () => client.getQueryData(listKey)?.pages.flatMap((page) => page.items),
  respond: (index, status) => requests[index].resolve(new Response(null, { status })),
};
const root = createRoot(document.getElementById('root'));
flushSync(() =>
  root.render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(ChatHeader, {
          sessionId: 'a',
          session: { ...row('a'), favoritedAt: null },
          canWrite: true,
        }),
      ),
    ),
  ),
);
