'use client';

import {
  IconClockRewind,
  IconCornerUpRight,
  IconFile02,
  IconFlipBackward,
  IconFolder,
  IconLock01,
  IconPencil01,
  IconTrash01,
} from '@/components/icons';
import type { BrowserItem, BrowserMenuEntry } from '@/features/files/browser';
import { displayFilename } from '@/features/files/lib/file-types';
import { type SortSpec } from '@/features/files/lib/library-items';
import { formatBytes } from '@/lib/format/format-bytes';
import { formatDate } from '@/lib/format/format-date';
import type { MemorySurfaceInitial } from '../api/surface';
import type { MemoryListView } from '../lib/memory-browser-state';
import { type DeletedMemoryNote, type MemoryNote, noteBasename } from '../lib/notes';
import { SCOPE_LABEL } from '../lib/virtual-path';
import type { MemoryNoteOpenMode, MemoryScope } from '../types';

type BrowserInputs = {
  initial: MemorySurfaceInitial;
  trimmedQ: string;
  scope: MemoryScope | null;
  inTrash: boolean;
  current: MemoryListView | { kind: 'loading' } | null;
  browseSort: SortSpec;
  access: MemorySurfaceInitial['access']['you'] | null;
  restoreDeleted: (note: DeletedMemoryNote) => void;
  openNote: (note: Pick<MemoryNote, 'id'>, mode: MemoryNoteOpenMode) => void;
  setRenamingKey: (key: string | null) => void;
  deleteNote: (note: MemoryNote) => void;
  /** The reader's zone for the "Deleted" dates. */
  timeZone: string;
};
export function memoryBrowserItems(input: BrowserInputs): BrowserItem[] {
  if (input.scope === null) return rootMemoryItems(input);
  if (input.inTrash) return deletedMemoryItems(input);
  if (input.current?.kind !== 'browse') return [];
  return [
    ...memoryFolderItems(input.current.folders, input.trimmedQ),
    ...memoryNoteItems(input.current.notes, input),
  ];
}
function rootMemoryItems({ initial, trimmedQ }: BrowserInputs): BrowserItem[] {
  return (['you', 'workspace'] as const)
    .filter((s) => trimmedQ === '' || SCOPE_LABEL[s].toLowerCase().includes(trimmedQ))
    .map((s): BrowserItem => {
      const canEdit = initial.access[s].canEdit;
      return {
        key: `scope:${s}`,
        kind: 'folder',
        name: SCOPE_LABEL[s],
        caption:
          s === 'you'
            ? 'Private to you'
            : canEdit
              ? 'Shared with your workspace'
              : 'Shared · view only',
        modifiedAt: null,
        sizeBytes: null,
        kindLabel: 'Folder',
        imageSrc: null,
        // Workspace reads as a read-only shared folder for members.
        glyph: s === 'workspace' && !canEdit ? IconLock01 : IconFolder,
        // The two root folders (the stores themselves) are structural: not
        // selectable and with no actions of their own. Editing happens on the
        // notes and subfolders inside them.
        selectable: false,
        menu: [],
      };
    });
}
function deletedMemoryItems({
  current,
  trimmedQ,
  access,
  restoreDeleted,
  timeZone,
}: BrowserInputs): BrowserItem[] {
  const items = current?.kind === 'trash' ? current.items : [];
  return items
    .filter((i) => trimmedQ === '' || i.path.toLowerCase().includes(trimmedQ))
    .map((item) => ({
      key: `deleted:${item.memoryId}`,
      kind: 'doc' as const,
      name: displayFilename(noteBasename(item.path)),
      renameName: noteBasename(item.path),
      caption: `Deleted ${formatDate(item.deletedAt, timeZone)}`,
      modifiedAt: item.deletedAt,
      sizeBytes: null,
      kindLabel: 'Note',
      imageSrc: null,
      glyph: IconFile02,
      selectable: false,
      menu: access?.canEdit
        ? [
            {
              kind: 'action' as const,
              id: 'restore',
              label: 'Restore',
              icon: IconFlipBackward,
              onSelect: () => restoreDeleted(item),
            },
          ]
        : [],
    }));
}
function memoryFolderItems(folders: string[], trimmedQ: string): BrowserItem[] {
  return folders
    .filter(
      (folderPath) => trimmedQ === '' || noteBasename(folderPath).toLowerCase().includes(trimmedQ),
    )
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map(
      (folderPath): BrowserItem => ({
        key: `mfolder:${folderPath}`,
        kind: 'folder',
        name: noteBasename(folderPath),
        caption: '',
        modifiedAt: null,
        sizeBytes: null,
        kindLabel: 'Folder',
        imageSrc: null,
        glyph: IconFolder,
        selectable: false,
        // No menu — a click opens the folder; there's nothing else to do to it.
        menu: [],
      }),
    );
}
function memoryNoteItems(entries: MemoryNote[], input: BrowserInputs): BrowserItem[] {
  const { trimmedQ, browseSort, access } = input;
  const notes = entries.filter(
    (n) => trimmedQ === '' || noteBasename(n.path).toLowerCase().includes(trimmedQ),
  );
  const sortFlip = browseSort.dir === 'asc' ? 1 : -1;
  return notes
    .slice()
    .sort((a, b) => {
      switch (browseSort.key) {
        case 'name':
        case 'kind':
          return sortFlip * a.path.localeCompare(b.path);
        case 'size':
          return sortFlip * (a.sizeBytes - b.sizeBytes);
        case 'modified':
          return sortFlip * a.updatedAt.localeCompare(b.updatedAt);
      }
    })
    .map(
      (note): BrowserItem => ({
        key: `note:${note.id}`,
        kind: 'doc',
        name: displayFilename(noteBasename(note.path)),
        renameName: noteBasename(note.path),
        caption: `Note · ${formatBytes(note.sizeBytes)}`,
        modifiedAt: note.updatedAt,
        sizeBytes: note.sizeBytes,
        kindLabel: 'Note',
        imageSrc: null,
        glyph: IconFile02,
        selectable: access?.canEdit ?? false,
        menu: noteMenu(note, input),
      }),
    );
}
function noteMenu(
  note: MemoryNote,
  { access, openNote, setRenamingKey, deleteNote }: BrowserInputs,
): BrowserMenuEntry[] {
  // No "Open" entry — clicking the note opens it (shared click-opens).
  const entries: BrowserMenuEntry[] = [
    {
      kind: 'action',
      id: 'history',
      label: 'History',
      icon: IconClockRewind,
      onSelect: () => openNote(note, 'history'),
    },
  ];
  if (access?.canEdit) {
    entries.push(
      {
        kind: 'action',
        id: 'rename',
        label: 'Rename',
        icon: IconPencil01,
        onSelect: () => setRenamingKey(`note:${note.id}`),
      },
      {
        kind: 'action',
        id: 'move',
        label: 'Move to…',
        icon: IconCornerUpRight,
        onSelect: () => openNote(note, 'move'),
      },
      { kind: 'separator', id: 'sep' },
      {
        kind: 'action',
        id: 'delete',
        label: 'Delete',
        icon: IconTrash01,
        destructive: true,
        onSelect: () => deleteNote(note),
      },
    );
  }
  return entries;
}
