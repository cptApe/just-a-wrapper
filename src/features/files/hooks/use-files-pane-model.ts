'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { artifactQueryKeys } from '@/features/files/api/keys';
import { classifyArtifact, MAX_TEXT_PREVIEW_BYTES } from '@/features/files/lib/artifact-kind';
import { buildOverlayHash, closeOverlayInPlace, openOverlay } from '@/features/overlays';
import { useLoadMoreSentinel } from '@/hooks/use-load-more-sentinel';
import { usePrefetchOnIntent } from '@/hooks/use-prefetch-on-intent';
import { fetchText } from '@/lib/fetch-json';
import { renameFolder } from '../api/folders';
import { fileQueryKeys } from '../api/keys';
import type { LibraryFilesPage } from '../api/load';
import { renameFile } from '../api/rename-file';
import { useLibraryFiles } from '../api/use-library-files';
import type { BrowserItem } from '../components/browser/types';
import {
  createFilesPaneSelectionActions,
  type NewTaskWithFiles,
} from '../components/files-pane-selection';
import { renameFileRow, renameFolderTree } from '../lib/library-cache';
import { breadcrumb, ROOT } from '../lib/paths';
import type { FileEntry, FolderEntry, UploadConfig } from '../types';
import { useBrowserSelection } from './use-browser-selection';
import { useFilesDialogs } from './use-files-dialogs';
import { useFilesFilters } from './use-files-filters';
import { useFilesPaneItems } from './use-files-pane-items';
import { useFilesPaneUploads } from './use-files-pane-uploads';
import { useLibraryFolders } from './use-library-folders';
import { useLibraryWrites } from './use-library-writes';

const NO_FOLDERS: FolderEntry[] = [];

export type FilesPaneProps = {
  /** Scopes the Library's cached queries. */
  organizationId: string;
  /** The workspace row whose storage folder uploads land in. */
  workspaceId: string;
  folders: FolderEntry[];
  folderCounts: Record<string, number>;
  initialPage: LibraryFilesPage;
  /** filesQueryKey of the query page.tsx rendered initialPage for. */
  initialQueryKey: string;
  uploadConfig: UploadConfig;
  canAdministerWorkspace: boolean;
  editableFolderPaths: string[];
  /** False for a one-person workspace: the pinned Team folder is hidden. */
  showTeamFolder: boolean;
  /** The Files/Memory toggle, swapped for the action bar while a selection exists. */
  tabToggle: React.ReactNode;
  newTaskWithFiles: NewTaskWithFiles;
};

/**
 * The Files pane in five parts, one job each: `filters` (what is shown, from the URL), `listing`
 * (the rows and how to open them), `selection` (bulk actions), `dialogs` (rename, menu, Move,
 * Share) and `uploads`.
 */
export function useFilesPaneModel(props: FilesPaneProps) {
  const { organizationId } = props;
  const expectedOrganizationId = useOrganizationId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const filters = useFilesFilters();
  const dialogs = useFilesDialogs();
  const page = useLibraryFiles({
    organizationId,
    query: filters.query,
    initialPage: props.initialPage,
    initialQueryKey: props.initialQueryKey,
  });
  const [pending, startTransition] = React.useTransition();
  // A list-changing write refreshes the cached file lists and the server-rendered folders and counts.
  const refreshLibrary = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: fileQueryKeys.all(organizationId) });
    void queryClient.invalidateQueries({ queryKey: artifactQueryKeys.all(organizationId) });
    router.refresh();
  }, [queryClient, organizationId, router]);
  const { folders, run } = useLibraryWrites({
    organizationId,
    folders: props.folders,
    refreshLibrary,
    startTransition,
  });
  const { visibleFolders, pinnedTeamItem } = useLibraryFolders({
    trash: filters.trash,
    deletedFolders: filters.trash ? page.deletedFolders : NO_FOLDERS,
    browsing: filters.browsing,
    folders,
    path: filters.path,
    sort: filters.sort,
    showTeamFolder: props.showTeamFolder,
  });
  const items = useFilesPaneItems({
    trash: filters.trash,
    files: page.files,
    folderCounts: props.folderCounts,
    visibleFolders,
    pinnedTeamItem,
    path: filters.path,
    openPath: filters.openPath,
    run,
    startRename: dialogs.startRename,
    openMove: dialogs.openMove,
    openShare: dialogs.openShare,
  });
  const fileById = React.useMemo(() => new Map(page.files.map((f) => [f.id, f])), [page.files]);

  const browserSelection = useBrowserSelection(items);
  const { clear: clearSelection } = browserSelection;
  // Leaving the view (folder, facet, tab) drops the selection.
  React.useEffect(() => {
    clearSelection();
  }, [filters.queryKey, clearSelection]);
  const selection = createFilesPaneSelectionActions({
    expectedOrganizationId,
    items,
    selection: browserSelection,
    fileById,
    browsing: filters.browsing,
    run,
    startTransition,
    closeMove: dialogs.closeMove,
    clearSelection,
    router,
    newTaskWithFiles: props.newTaskWithFiles,
  });

  const listing = useFilesListing({
    filters,
    items,
    fileById,
    page,
    organizationId,
    clearSelection,
  });

  const uploads = useFilesPaneUploads({
    uploadConfig: props.uploadConfig,
    workspaceId: props.workspaceId,
    path: filters.path,
    trash: filters.trash,
    refreshLibrary,
  });

  function commitRename(item: BrowserItem, name: string) {
    dialogs.endRename();
    if (item.kind === 'folder') {
      const folderPath = item.key.slice('folder:'.length);
      run({
        action: () => renameFolder(folderPath, name),
        success: 'Folder renamed',
        failure: 'Couldn’t rename the folder',
        folders: renameFolderTree(folderPath, name),
      });
      return;
    }
    const fileId = item.key.slice('file:'.length);
    run({
      action: () => renameFile(fileId, name),
      success: 'File renamed',
      failure: 'Couldn’t rename the file',
      files: renameFileRow(fileId, name),
    });
  }

  return {
    tabToggle: props.tabToggle,
    pending,
    filters,
    listing: { ...listing, folders, retry: refreshLibrary },
    selection: { ...selection, browser: browserSelection },
    dialogs: {
      ...dialogs,
      commitRename,
      canAdministerWorkspace: props.canAdministerWorkspace,
      editableFolderPaths: props.editableFolderPaths,
    },
    uploads,
  };
}

export type FilesPaneModel = ReturnType<typeof useFilesPaneModel>;

/** The rows on screen, the trail above them, and the ways to open, preview and page through them. */
function useFilesListing({
  filters,
  items,
  fileById,
  page,
  organizationId,
  clearSelection,
}: {
  filters: ReturnType<typeof useFilesFilters>;
  items: BrowserItem[];
  fileById: Map<string, FileEntry>;
  page: ReturnType<typeof useLibraryFiles>;
  organizationId: string;
  clearSelection: () => void;
}) {
  const { onIntent } = usePrefetchOnIntent();
  const sentinelRef = useLoadMoreSentinel<HTMLDivElement>({
    canLoadMore: page.hasMore && !page.loadingMore,
    loadMore: page.loadMore,
  });

  function openFolder(folderPath: string) {
    // Close an open canvas before the path push so folder entries never stack under it.
    closeOverlayInPlace();
    filters.openPath(folderPath === ROOT ? null : folderPath);
    clearSelection();
  }

  function open(item: BrowserItem) {
    if (filters.trash) return;
    if (item.kind === 'folder') {
      openFolder(item.key.slice('folder:'.length));
      return;
    }
    const file = fileById.get(item.key.slice('file:'.length));
    if (file) openOverlay(buildOverlayHash('file', file.id));
  }

  // Only text previews under the size cap warm here: PDFs read binary bytes under
  // the same query key, so a text fetch would poison that entry.
  const prefetch = (item: BrowserItem) => {
    if (filters.trash || item.kind !== 'doc') return;
    const file = fileById.get(item.key.slice('file:'.length));
    if (!file) return;
    const kind = classifyArtifact(file.mimeType, file.filename);
    const textPreviewable =
      kind === 'markdown' || kind === 'code' || kind === 'csv' || kind === 'html';
    if (!textPreviewable || file.sizeBytes > MAX_TEXT_PREVIEW_BYTES) return;
    onIntent(fileQueryKeys.text(organizationId, file.url), ({ signal }) =>
      fetchText(file.url, { signal }),
    );
  };

  return {
    items,
    loading: page.loading,
    errored: page.errored,
    hasMore: page.hasMore,
    sentinelRef,
    trailingSkeletons: page.loadingMore ? 3 : 0,
    crumbs: breadcrumb(filters.path),
    showBreadcrumbs: filters.browsing && filters.path !== ROOT,
    openFolder,
    open,
    prefetch,
  };
}
