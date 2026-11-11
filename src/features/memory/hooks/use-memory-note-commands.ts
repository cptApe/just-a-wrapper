'use client';

import { useQueryClient } from '@tanstack/react-query';
import { memoryQueryKeys } from '../api/keys';
import type { useMemoryNoteMutations } from '../api/use-memory-note-mutations';
import type { MemoryNote } from '../lib/notes';
import type { MemoryScope } from '../types';

export function useMemoryNoteCommands({
  note,
  scope,
  organizationId,
  mutations,
  onClose,
  closeRename,
  closeHistory,
}: {
  note: MemoryNote | null;
  scope: MemoryScope;
  organizationId: string | null;
  mutations: ReturnType<typeof useMemoryNoteMutations>;
  onClose: () => void;
  closeRename: () => void;
  closeHistory: () => void;
}) {
  const queryClient = useQueryClient();
  function deleteNote(intent: 'delete' | 'discard') {
    if (!note) return;
    mutations.actions.remove({ scope, note, intent }, { onSuccess: onClose });
  }
  function renameTo(newPath: string) {
    if (!note) return;
    mutations.actions.rename({ scope, note, newPath, moved: true }, { onSuccess: closeRename });
  }
  function onHistoryRestored() {
    closeHistory();
    // Restore rewrites the note; refresh both its cached content and the lists.
    void queryClient.invalidateQueries({
      queryKey: memoryQueryKeys.all(organizationId ?? 'unscoped'),
    });
  }
  return { deleteNote, renameTo, onHistoryRestored };
}
