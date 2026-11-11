'use client';
import { type ReactNode, useMemo, useState } from 'react';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import {
  BrowserContextMenu,
  type BrowserContextMenuState,
  type BrowserItem,
} from '@/features/files/browser';
import type { SortSpec } from '@/features/files/lib/library-items';
import { closeOverlayInPlace } from '@/features/overlays';
import type { MemorySurfaceInitial } from '../api/surface';
import { useDeleteSelectedNotes } from '../hooks/use-delete-selected-notes';
import { useMemoryBrowser } from '../hooks/use-memory-browser';
import { useMemoryNoteActions } from '../hooks/use-memory-note-actions';
import { useMemoryRename } from '../hooks/use-memory-rename';
import { useMemorySelection } from '../hooks/use-memory-selection';
import { memoryBreadcrumbs } from '../lib/memory-breadcrumbs';
import type { MemoryScope } from '../types';
import { memoryBrowserItems } from './memory-browser-items';
import { MemoryPaneToolbar } from './memory-pane-toolbar';
import { MemoryPaneView } from './memory-pane-view';

export function MemoryBrowser({
  taskPending,
  initial,
  tabToggle,
  scope,
  storePath,
  inTrash,
  layout,
  trimmedQ,
  searchResults,
  navigate,
  onToggleTrash,
  onLayoutChange,
}: {
  taskPending: boolean;
  initial: MemorySurfaceInitial;
  tabToggle: ReactNode;
  scope: MemoryScope | null;
  storePath: string;
  inTrash: boolean;
  layout: 'grid' | 'list';
  trimmedQ: string;
  /** Shown in place of the folder while a search runs; null when not searching. */
  searchResults: ReactNode;
  navigate: (path: string) => void;
  onToggleTrash: (checked: boolean) => void;
  onLayoutChange: (layout: 'grid' | 'list') => void;
}) {
  const atRoot = scope === null;
  const access = scope ? initial.access[scope] : null;
  const { current, invalidate, sentinelRef, activeKey } = useMemoryBrowser({
    initial,
    scope,
    storePath,
    inTrash,
    atRoot,
    access,
  });
  const {
    openNote,
    deleteNote,
    restoreDeleted,
    pending: restorePending,
  } = useMemoryNoteActions({ scope, invalidate });
  const {
    renamingKey,
    setRenamingKey,
    renameNoteInline,
    pending: renamePending,
  } = useMemoryRename({ scope });
  const [contextMenu, setContextMenu] = useState<BrowserContextMenuState>(null);
  const [browseSort, setBrowseSort] = useState<SortSpec>({ key: 'name', dir: 'asc' });
  const { timeZone } = useDisplayFormat();
  const items = useMemo(
    () =>
      memoryBrowserItems({
        initial,
        trimmedQ,
        scope,
        inTrash,
        current,
        browseSort,
        access,
        openNote,
        deleteNote,
        restoreDeleted,
        setRenamingKey,
        timeZone,
      }),
    [
      initial,
      trimmedQ,
      scope,
      inTrash,
      current,
      browseSort,
      access,
      openNote,
      deleteNote,
      restoreDeleted,
      setRenamingKey,
      timeZone,
    ],
  );
  const { selection, noteById, openItem, allSelected, toggleSelectAll } = useMemorySelection({
    items,
    scope,
    navigate,
    current,
    openNote,
    activeKey,
    trimmedQ,
  });
  const { pending, deleteSelectedNotes } = useDeleteSelectedNotes({
    scope,
    selected: selection.selected,
    clearSelection: selection.clear,
  });
  const loading = current?.kind === 'loading';
  const errored = current !== null && current.kind !== 'loading' && current.status === 'error';
  const hasMore =
    current !== null && current.kind !== 'loading' && current.status === 'ready' && current.hasMore;
  const loadingMore = current !== null && current.kind !== 'loading' && current.loadingMore;
  const interaction = {
    items,
    selected: selection.selected,
    selectionMode: selection.selectionMode,
    interaction: 'open' as const,
    onOpen: openItem,
    onItemClick: selection.onItemClick,
    onToggleSelect: selection.toggle,
    renamingKey,
    onRenameCommit: (item: BrowserItem, name: string) => {
      const note = noteById.get(item.key.slice('note:'.length));
      if (note) renameNoteInline(note, name);
    },
    onRenameCancel: () => setRenamingKey(null),
    dragKeysFor: selection.dragKeysFor,
    setContextMenu,
    trailingSkeletons: loadingMore ? 3 : 0,
  };
  return (
    <>
      <MemoryPaneToolbar
        selectionCount={selection.selected.size}
        onClear={selection.clear}
        onDeleteSelected={deleteSelectedNotes}
        pending={pending || restorePending || renamePending || taskPending}
        tabToggle={tabToggle}
        atRoot={atRoot}
        inTrash={inTrash}
        onToggleTrash={onToggleTrash}
        layout={layout}
        onLayoutChange={onLayoutChange}
      />
      <MemoryPaneView
        atRoot={atRoot}
        inTrash={inTrash}
        access={access}
        layout={layout}
        trimmedQ={trimmedQ}
        searchResults={searchResults}
        crumbs={memoryBreadcrumbs(scope, storePath)}
        navigate={(next) => {
          closeOverlayInPlace();
          navigate(next);
        }}
        loading={loading}
        errored={errored}
        invalidate={invalidate}
        gridProps={interaction}
        listProps={{
          ...interaction,
          sort: browseSort,
          onSortChange: setBrowseSort,
          onToggleSelectAll: access?.canEdit ? toggleSelectAll : undefined,
          allSelected,
        }}
        hasMore={hasMore}
        sentinelRef={sentinelRef}
      />
      <BrowserContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </>
  );
}
