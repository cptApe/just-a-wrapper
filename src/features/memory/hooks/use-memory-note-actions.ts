'use client';
import * as React from 'react';
import { toast } from 'sonner';
import { useOrganizationId } from '@/components/providers/app-providers';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import { restoreDeletedMemoryNote } from '../api/actions';
import { useMemoryNoteMutations } from '../api/use-memory-note-mutations';
import type { DeletedMemoryNote, MemoryNote } from '../lib/notes';
import type { MemoryNoteOpenMode, MemoryScope } from '../types';
export function useMemoryNoteActions({
  scope,
  invalidate,
}: {
  scope: MemoryScope | null;
  invalidate: () => void;
}) {
  const mutations = useMemoryNoteMutations(useOrganizationId());
  const [pending, startTransition] = React.useTransition();
  const openNote = React.useCallback(
    (note: Pick<MemoryNote, 'id'>, mode: MemoryNoteOpenMode) => {
      if (scope === null) return;
      openOverlay(
        buildOverlayHash('memory', note.id, {
          scope,
          ...(mode === 'history' ? { history: '1' } : {}),
          ...(mode === 'move' ? { move: '1' } : {}),
        }),
      );
    },
    [scope],
  );

  const remove = mutations.actions.remove;
  const deleteNote = React.useCallback(
    (note: MemoryNote) => {
      if (scope === null) return;
      remove({ scope, note, intent: 'delete' });
    },
    [scope, remove],
  );

  const restoreDeleted = React.useCallback(
    (item: DeletedMemoryNote) => {
      if (scope === null) return;
      startTransition(async () => {
        const res = await restoreDeletedMemoryNote(scope, item);
        if (!res.ok) {
          toast.error('Couldn’t restore the note', { description: res.message });
          return;
        }
        toast.success('Note restored');
        invalidate();
      });
    },
    [scope, invalidate],
  );

  return { openNote, deleteNote, restoreDeleted, pending };
}
