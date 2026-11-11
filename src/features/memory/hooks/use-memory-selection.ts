'use client';

import * as React from 'react';
import { type BrowserItem, useBrowserSelection } from '@/features/files/browser';
import { closeOverlayInPlace } from '@/features/overlays';
import type { MemoryListView } from '../lib/memory-browser-state';
import { type MemoryNote, NOTE_ROOT } from '../lib/notes';
import { toVirtualPath } from '../lib/virtual-path';
import type { MemoryNoteOpenMode, MemoryScope } from '../types';

export function useMemorySelection({
  items,
  scope,
  navigate,
  current,
  openNote,
  activeKey,
  trimmedQ,
}: {
  activeKey: string | null;
  trimmedQ: string;
  items: BrowserItem[];
  scope: MemoryScope | null;
  navigate: (path: string) => void;
  current: MemoryListView | { kind: 'loading' } | null;
  openNote: (note: Pick<MemoryNote, 'id'>, mode: MemoryNoteOpenMode) => void;
}) {
  const noteById = React.useMemo(() => {
    const map = new Map<string, MemoryNote>();
    if (current?.kind === 'browse') for (const note of current.notes) map.set(note.id, note);
    return map;
  }, [current]);

  const selection = useBrowserSelection(items);
  const { clear: clearSelection } = selection;

  React.useEffect(() => {
    clearSelection();
  }, [activeKey, trimmedQ, clearSelection]);
  const selectableCount = items.filter((i) => i.selectable).length;
  const allSelected = selectableCount > 0 && selection.selected.size === selectableCount;
  const toggleSelectAll = allSelected ? clearSelection : selection.selectAll;

  function openItem(item: BrowserItem) {
    if (item.key.startsWith('scope:')) {
      const s = item.key === 'scope:workspace' ? 'workspace' : 'you';
      closeOverlayInPlace();
      navigate(toVirtualPath(s, NOTE_ROOT));
      return;
    }
    if (item.key.startsWith('mfolder:') && scope !== null) {
      closeOverlayInPlace();
      navigate(toVirtualPath(scope, item.key.slice('mfolder:'.length)));
      return;
    }
    if (item.key.startsWith('note:')) {
      const note = noteById.get(item.key.slice('note:'.length));
      if (note) openNote(note, 'read');
    }
  }

  return {
    selection,
    noteById,
    openItem,
    allSelected,
    toggleSelectAll,
  };
}
