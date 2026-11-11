'use client';
import { useOrganizationId } from '@/components/providers/app-providers';
import { useMemoryNoteMutations } from '../api/use-memory-note-mutations';
import type { MemoryScope } from '../types';

export function useDeleteSelectedNotes({
  scope,
  selected,
  clearSelection,
}: {
  scope: MemoryScope | null;
  selected: ReadonlySet<string>;
  clearSelection: () => void;
}) {
  const { actions, pending } = useMemoryNoteMutations(useOrganizationId());
  function deleteSelectedNotes() {
    if (scope === null) return;
    const ids = [...selected]
      .filter((k) => k.startsWith('note:'))
      .map((k) => k.slice('note:'.length));
    if (ids.length === 0) return;
    actions.removeMany({ scope, ids });
    clearSelection();
  }
  return { pending: pending.removeMany, deleteSelectedNotes };
}
