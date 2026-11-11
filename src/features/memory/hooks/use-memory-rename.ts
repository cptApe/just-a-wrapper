'use client';
import * as React from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { useMemoryNoteMutations } from '../api/use-memory-note-mutations';
import { joinNotePath, type MemoryNote, noteParentPath } from '../lib/notes';
import type { MemoryScope } from '../types';

export function useMemoryRename({ scope }: { scope: MemoryScope | null }) {
  const [renamingKey, setRenamingKey] = React.useState<string | null>(null);
  const { actions, pending } = useMemoryNoteMutations(useOrganizationId());
  function renameNoteInline(note: MemoryNote, newName: string) {
    setRenamingKey(null);
    if (scope === null) return;
    const filename = newName.toLowerCase().endsWith('.md') ? newName : `${newName}.md`;
    const newPath = joinNotePath(noteParentPath(note.path), filename);
    actions.rename({ scope, note, newPath, moved: false });
  }

  return { renamingKey, setRenamingKey, renameNoteInline, pending: pending.rename };
}
