import type { useRouter } from 'next/navigation';
import type * as React from 'react';
import { toast } from 'sonner';
import { reloadWorkspaceChanged } from '@/lib/reload-workspace-changed';
import { deleteFiles } from '../api/delete-files';
import { deleteFolder } from '../api/folders';
import { moveFiles, moveFolder } from '../api/move';
import type { useBrowserSelection } from '../hooks/use-browser-selection';
import type { RunLibraryWrite } from '../hooks/use-library-writes';
import { downloadUrl } from '../lib/download-url';
import { dropFiles, moveFolderTrees, removeFolderTrees } from '../lib/library-cache';
import { isTeamPath, isWithin } from '../lib/paths';
import type { ActionResult, FileEntry, ShareTarget } from '../types';
import type { BrowserItem } from './browser/types';

export type MoveTarget = { fileIds: string[]; folderPaths: string[] };

/** Starts a task with the selected Library items; the library page passes it in because it starts a session. */
export type NewTaskWithFiles = (
  fileIds: string[],
  folderPaths: string[],
  expectedOrganizationId: string,
) => Promise<ActionResult<{ sessionId: string }>>;

export function createFilesPaneSelectionActions({
  items,
  expectedOrganizationId,
  selection,
  fileById,
  browsing,
  run,
  startTransition,
  closeMove,
  clearSelection,
  router,
  newTaskWithFiles,
}: {
  items: BrowserItem[];
  expectedOrganizationId: string | null;
  selection: ReturnType<typeof useBrowserSelection>;
  fileById: Map<string, FileEntry>;
  browsing: boolean;
  run: RunLibraryWrite;
  startTransition: React.TransitionStartFunction;
  closeMove: () => void;
  clearSelection: () => void;
  router: ReturnType<typeof useRouter>;
  newTaskWithFiles: NewTaskWithFiles;
}) {
  function keysToSelection(keys: string[]): { fileIds: string[]; folderPaths: string[] } {
    return {
      fileIds: keys.filter((k) => k.startsWith('file:')).map((k) => k.slice('file:'.length)),
      folderPaths: keys
        .filter((k) => k.startsWith('folder:'))
        .map((k) => k.slice('folder:'.length)),
    };
  }

  function executeMove(target: { fileIds: string[]; folderPaths: string[] }, destination: string) {
    closeMove();
    clearSelection();
    run({
      action: () =>
        firstFailure([
          ...(target.fileIds.length > 0 ? [() => moveFiles(target.fileIds, destination)] : []),
          ...target.folderPaths.map((folderPath) => () => moveFolder(folderPath, destination)),
        ]),
      // Landing in the Team subtree IS sharing — say so.
      success: isTeamPath(destination) ? 'Shared with your team' : 'Moved',
      failure: 'Couldn’t move that',
      // A search or facet view lists the file wherever it lives, so only a folder view loses the row.
      files: browsing ? dropFiles(target.fileIds) : undefined,
      folders: moveFolderTrees(target.folderPaths, destination),
    });
  }

  function handleDropMove(keys: string[], targetPath: string) {
    const target = keysToSelection(keys);
    // A folder cannot be moved into itself or one of its descendants.
    if (target.folderPaths.some((p) => isWithin(p, targetPath))) {
      toast.error('Can’t move a folder into itself');
      return;
    }
    executeMove(target, targetPath);
  }

  const selectedKeys = [...selection.selected];
  const selectableCount = items.filter((i) => i.selectable).length;
  const allSelected = selectableCount > 0 && selection.selected.size === selectableCount;
  const toggleSelectAll = allSelected ? clearSelection : selection.selectAll;
  const selectedFiles = keysToSelection(selectedKeys)
    .fileIds.map((id) => fileById.get(id))
    .filter((f): f is FileEntry => f !== undefined);
  const selectedFolderPaths = keysToSelection(selectedKeys).folderPaths;
  const selectedFile = selectedFiles.at(0);
  const selectedFolder = selectedFolderPaths.at(0);
  const shareableTarget: ShareTarget | null =
    selectedKeys.length !== 1
      ? null
      : selectedFile !== undefined
        ? { kind: 'file', fileId: selectedFile.id, filename: selectedFile.filename }
        : selectedFolder !== undefined
          ? { kind: 'folder', folderPath: selectedFolder }
          : null;

  function downloadSelected() {
    if (selectedFiles.length === 0) {
      toast.error('Nothing to download', { description: 'Only files can be downloaded.' });
      return;
    }
    // Staggered so the browser treats them as separate downloads instead of
    // cancelling all but the last navigation.
    selectedFiles.forEach((file, idx) => {
      window.setTimeout(() => triggerDownload(downloadUrl(file.url), file.filename), idx * 300);
    });
  }

  function deleteSelected() {
    const fileIds = selectedFiles.map((f) => f.id);
    const folderPaths = selectedFolderPaths;
    clearSelection();
    run({
      action: () =>
        firstFailure([
          ...(fileIds.length > 0 ? [() => deleteFiles(fileIds)] : []),
          ...folderPaths.map((folderPath) => () => deleteFolder(folderPath)),
        ]),
      success: 'Deleted',
      failure: 'Couldn’t delete that',
      files: dropFiles(fileIds),
      folders: removeFolderTrees(folderPaths),
    });
  }

  function newTaskWithSelection() {
    if (expectedOrganizationId === null) return;
    if (selectedFiles.length === 0 && selectedFolderPaths.length === 0) {
      toast.error('Select at least one file or folder');
      return;
    }
    startTransition(async () => {
      // Reference-only: files ride as durable-URL lines, folders as Library-path
      // references the agent lists on demand (new-task-with-files.ts).
      const res = await newTaskWithFiles(
        selectedFiles.map((f) => f.id),
        selectedFolderPaths,
        expectedOrganizationId,
      );
      if (!res.ok) {
        if (reloadWorkspaceChanged({ code: res.code })) return;
        toast.error('Couldn’t start the task', { description: res.message });
        return;
      }
      router.push(`/app/task/${res.data.sessionId}`);
    });
  }

  return {
    allSelected,
    deleteSelected,
    downloadSelected,
    executeMove,
    handleDropMove,
    keysToSelection,
    newTaskWithSelection,
    selectedFiles,
    selectedFolderPaths,
    selectedKeys,
    shareableTarget,
    toggleSelectAll,
  };
}

async function firstFailure(
  steps: Array<() => Promise<ActionResult<unknown>>>,
): Promise<ActionResult<unknown>> {
  const results: Array<ActionResult<unknown>> = [];
  for (const step of steps) results.push(await step());
  return results.find((result) => !result.ok) ?? { ok: true, data: undefined };
}

export function triggerDownload(href: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
