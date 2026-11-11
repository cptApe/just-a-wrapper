'use client';

import { IconSearchMd } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { FilesPaneModel } from '../hooks/use-files-pane-model';
import { ROOT, TEAM_FOLDER_PATH } from '../lib/paths';
import { BrowserBreadcrumbs } from './browser/breadcrumbs';
import { BrowserGrid } from './browser/browser-grid';
import { BrowserList } from './browser/browser-list';
import { BrowserSkeletons } from './browser/browser-skeletons';
import { FilesEmptyState, UploadProgressTiles } from './files-pane-states';

/** The page body: the trail, upload progress, and the rows in their loading, error, empty or listed state. */
export function FilesListing({
  filters,
  listing,
  selection,
  dialogs,
  uploads,
}: Pick<FilesPaneModel, 'filters' | 'listing' | 'selection' | 'dialogs' | 'uploads'>) {
  const {
    items,
    loading,
    errored,
    retry,
    hasMore,
    sentinelRef,
    trailingSkeletons,
    crumbs,
    showBreadcrumbs,
    openFolder,
    open,
    prefetch,
  } = listing;
  const { browser } = selection;
  // The grid and the list take the same handlers.
  const shared = {
    items,
    selected: browser.selected,
    selectionMode: browser.selectionMode,
    interaction: 'open' as const,
    onOpen: open,
    onIntent: prefetch,
    onItemClick: browser.onItemClick,
    onToggleSelect: browser.toggle,
    onDropMove: filters.trash ? undefined : selection.handleDropMove,
    renamingKey: dialogs.renamingKey,
    onRenameCommit: dialogs.commitRename,
    onRenameCancel: dialogs.endRename,
    dragKeysFor: browser.dragKeysFor,
    setContextMenu: dialogs.setContextMenu,
    trailingSkeletons,
  };
  return (
    <>
      {/* The empty trash state says the same thing, so the line shows only above deleted items. */}
      {filters.trash && items.length > 0 ? (
        <p className="text-meta text-muted-foreground">
          Deleted items stay here for 30 days, then they’re gone for good.
        </p>
      ) : null}
      {showBreadcrumbs ? (
        <BrowserBreadcrumbs
          crumbs={crumbs}
          onNavigate={openFolder}
          onDropMove={selection.handleDropMove}
        />
      ) : null}

      {uploads.tasks.length > 0 ? <UploadProgressTiles tasks={uploads.tasks} /> : null}

      {loading ? (
        <BrowserSkeletons view={filters.fileView} label="Loading files" />
      ) : errored ? (
        <EmptyState
          icon={IconSearchMd}
          title="Couldn’t load your files"
          description="Something went wrong reading this view. Try again"
          action={
            <Button type="button" variant="secondary" size="sm" onClick={retry}>
              Try again
            </Button>
          }
        />
      ) : items.length === 0 && uploads.tasks.length === 0 ? (
        <FilesEmptyState
          searching={filters.trimmedQ !== ''}
          type={filters.type}
          trash={filters.trash}
          insideFolder={filters.path !== ROOT}
          teamRoot={filters.path === TEAM_FOLDER_PATH}
          uploadOffReason={uploads.offReason}
        />
      ) : filters.fileView === 'grid' ? (
        <BrowserGrid {...shared} />
      ) : (
        <BrowserList
          {...shared}
          sort={filters.sort}
          onSortChange={filters.changeSort}
          onToggleSelectAll={selection.toggleSelectAll}
          allSelected={selection.allSelected}
        />
      )}
      {hasMore ? <div ref={sentinelRef} aria-hidden className="h-px" /> : null}
    </>
  );
}
