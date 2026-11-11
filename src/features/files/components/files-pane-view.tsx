'use client';

import { IconUploadCloud01 } from '@/components/icons';
import { PageBody, PageHeader } from '@/components/layouts/page-shell';
import { SearchField } from '@/components/ui/search-field';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import type { FilesPaneModel } from '../hooks/use-files-pane-model';
import { ROOT } from '../lib/paths';
import { BrowserContextMenu } from './browser/item-menu';
import { FilesListing } from './files-listing';
import { FilesToolbar } from './files-toolbar';
import { FilesNewMenu } from './library-new-menu';
import { MoveModal } from './move-modal';
import { ShareModal } from './share-modal';

export function FilesPaneView(model: FilesPaneModel) {
  const { filters, listing, selection, dialogs, uploads, pending, tabToggle } = model;
  const folderHash = (kind: 'new-folder' | 'new-note') =>
    buildOverlayHash(kind, null, filters.path !== ROOT ? { path: filters.path } : undefined);
  return (
    <>
      <PageHeader
        title="Library"
        action={
          <>
            <SearchField
              value={filters.searchInput}
              onChange={filters.search}
              placeholder="Search files"
            />
            {filters.trash ? null : (
              <FilesNewMenu
                uploadOffReason={uploads.offReason}
                onPickFiles={uploads.pickFiles}
                onNewFolder={() => openOverlay(folderHash('new-folder'))}
                onNewNote={() => openOverlay(folderHash('new-note'))}
              />
            )}
          </>
        }
      />
      <FilesToolbar {...{ filters, selection, dialogs, pending, tabToggle }} />
      <PageBody className="flex flex-col gap-4">
        <FilesListing {...{ filters, listing, selection, dialogs, uploads }} />
      </PageBody>

      <BrowserContextMenu state={dialogs.contextMenu} onClose={dialogs.closeContextMenu} />

      {/* Drag-anywhere upload overlay with folder support; per-file progress shows as tiles. */}
      {uploads.dragging ? (
        <div
          className="fixed inset-0 z-dialog flex items-center justify-center bg-background/70 p-8 backdrop-blur-sm"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            uploads.drop(e.dataTransfer);
          }}
        >
          <div className="pointer-events-none flex w-full max-w-lg flex-col items-center gap-3 rounded-xl border-2 border-dashed border-ring bg-background p-12 text-center">
            <IconUploadCloud01 className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-title-card font-semibold text-foreground">
              Drop to upload{' '}
              {filters.path === ROOT
                ? 'to your Library'
                : `into ${listing.crumbs[listing.crumbs.length - 1]?.name}`}
            </p>
            <p className="text-meta text-muted-foreground">
              {uploads.offReason ?? 'Files and folders both work.'}
            </p>
          </div>
        </div>
      ) : null}

      {dialogs.moveTarget && (
        <MoveModal
          folders={listing.folders}
          disabledSubtrees={dialogs.moveTarget.folderPaths}
          itemLabel={
            dialogs.moveTarget.fileIds.length + dialogs.moveTarget.folderPaths.length === 1
              ? '1 item'
              : `${dialogs.moveTarget.fileIds.length + dialogs.moveTarget.folderPaths.length} items`
          }
          busy={pending}
          onMove={(destination) => {
            if (dialogs.moveTarget) selection.executeMove(dialogs.moveTarget, destination);
          }}
          onOpenChange={(open) => {
            if (!open) dialogs.closeMove();
          }}
        />
      )}
      {dialogs.shareTarget && (
        <ShareModal
          key={
            dialogs.shareTarget.kind === 'file'
              ? dialogs.shareTarget.fileId
              : dialogs.shareTarget.folderPath
          }
          open
          target={dialogs.shareTarget}
          canCreateEditShare={
            dialogs.shareTarget.kind === 'folder' &&
            (dialogs.canAdministerWorkspace ||
              dialogs.editableFolderPaths.includes(dialogs.shareTarget.folderPath))
          }
          onOpenChange={(open) => {
            if (!open) dialogs.closeShare();
          }}
        />
      )}
    </>
  );
}
