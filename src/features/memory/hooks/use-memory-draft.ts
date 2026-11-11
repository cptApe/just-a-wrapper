'use client';

import { useReducer } from 'react';
import { toast } from 'sonner';
import { AppError } from '@/lib/errors';
import type { SaveVariables } from '../api/use-memory-note-mutations';
import { reduceDraft } from '../lib/draft-machine';
import type { MemoryNote } from '../lib/notes';
import type { MemoryScope } from '../types';

export function useMemoryDraft({
  note,
  canEdit,
  refetch,
  save,
  scope,
  initialEdit,
}: {
  note: MemoryNote | null;
  canEdit: boolean;
  refetch: () => Promise<{ isError: boolean }>;
  save: (
    input: SaveVariables,
    callbacks: { onSuccess: () => void; onError: (error: Error) => void },
  ) => void;
  scope: MemoryScope;
  initialEdit: boolean;
}) {
  const [editor, dispatch] = useReducer(reduceDraft, { kind: initialEdit ? 'waiting' : 'read' });
  function startEdit() {
    if (note && canEdit)
      dispatch({ type: 'edit', draft: note.content ?? '', baseContentSha256: note.contentSha256 });
  }
  if (editor.kind === 'waiting' && note && canEdit)
    dispatch({ type: 'edit', draft: note.content ?? '', baseContentSha256: note.contentSha256 });
  function saveDraft() {
    if (!note || editor.kind !== 'editing') return;
    const token = crypto.getRandomValues(new Uint32Array(4)).join('-');
    dispatch({ type: 'save', attempt: token });
    save(
      { scope, note, content: editor.draft, base: { contentSha256: editor.baseContentSha256 } },
      {
        onSuccess: () => {
          dispatch({ type: 'saved', attempt: token });
        },
        onError: (error) => {
          dispatch({
            type:
              error instanceof AppError && error.code === 'MEMORY_EDIT_CONFLICT'
                ? 'conflict'
                : 'failed',
            attempt: token,
          });
        },
      },
    );
  }
  async function reloadAfterConflict() {
    if (editor.kind !== 'conflict') return;
    const token = crypto.getRandomValues(new Uint32Array(4)).join('-');
    dispatch({ type: 'reload', attempt: token });
    const response = await refetch();
    dispatch({ type: response.isError ? 'reloadFailed' : 'reloaded', attempt: token });
    if (response.isError)
      toast.error('Couldn’t reload the note', {
        description: 'Your draft is still here. Try again.',
      });
  }
  return {
    editor,
    saveDraft,
    startEdit,
    reloadAfterConflict,
    actions: {
      cancel: () => dispatch({ type: 'cancel' }),
      change: (draft: string) => dispatch({ type: 'change', draft }),
    },
  };
}
