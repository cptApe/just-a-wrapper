// Real React and query hooks with controlled server-action and HTTP boundaries.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useMemoryDraft } from '../../src/features/memory/hooks/use-memory-draft';
import { useMemoryNoteCommands } from '../../src/features/memory/hooks/use-memory-note-commands';
import { useMemoryTask } from '../../src/features/memory/hooks/use-memory-task';
import { useCreateSkillTask } from '../../src/features/skills/hooks/use-create-skill-task';
import { useEditSkillTask } from '../../src/features/skills/hooks/use-edit-skill-task';
import { AppError } from '../../src/lib/errors';

// The library page passes the real server action; the test counts calls and holds the result.
const askAgentToUpdateMemory = () => {
  window.harness.taskCalls++;
  return new Promise((resolve) => {
    window.harness.finishTask = resolve;
  });
};

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } },
});
const h = (window.harness = {
  client,
  captured: [],
  messages: [],
  routes: [],
  saves: [],
  commands: [],
  refetchFails: false,
  taskCalls: 0,
  note: { id: 'note', path: '/note.md', content: 'Original', contentSha256: 'sha' },
  response: { status: 402, code: 'CREDITS_EXHAUSTED', message: 'Add credits to continue.' },
  save: (input, callbacks) => h.saves.push({ input, callbacks }),
});
window.fetch = async () =>
  Response.json(
    { error: { code: h.response.code, message: h.response.message } },
    { status: h.response.status },
  );
const mutations = {
  actions: {
    remove: (input, callbacks) => {
      h.commands.push(['remove', input]);
      callbacks.onSuccess();
    },
    rename: (input, callbacks) => {
      h.commands.push(['rename', input]);
      callbacks.onSuccess();
    },
  },
};
function Harness() {
  const draft = useMemoryDraft({
    note: h.note,
    canEdit: true,
    scope: 'you',
    initialEdit: true,
    refetch: async () => ({ isError: h.refetchFails }),
    save: h.save,
  });
  const commands = useMemoryNoteCommands({
    note: h.note,
    scope: 'you',
    organizationId: 'workspace',
    mutations,
    onClose: () => h.commands.push(['close']),
    closeRename: () => h.commands.push(['closeRename']),
    closeHistory: () => h.commands.push(['closeHistory']),
  });
  const task = useMemoryTask('you', askAgentToUpdateMemory);
  const create = useCreateSkillTask();
  const edit = useEditSkillTask({ id: 'skill', name: 'Guide', files: [] });
  useLayoutEffect(() => {
    Object.assign(h, { draft, commandsHook: commands, task, create, edit });
  });
  return null;
}
h.conflict = () =>
  h.saves.at(-1).callbacks.onError(new AppError('MEMORY_EDIT_CONFLICT', 'Changed remotely'));
createRoot(document.getElementById('root')).render(
  React.createElement(QueryClientProvider, { client }, React.createElement(Harness)),
);
