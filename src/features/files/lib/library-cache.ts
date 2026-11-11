import type { InfiniteData } from '@tanstack/react-query';
import type { LibraryFilesPage } from '../api/load';
import type { FileEntry, FolderEntry } from '../types';
import { basename, isWithin, joinPath, parentPath, rewritePrefix } from './paths';

// Pure edits behind instant Library writes. File rows live in React Query; folders are server props.

export type LibraryCache = InfiniteData<LibraryFilesPage, number>;
/** Returns the row to keep, or null to drop it. */
export type FileEdit = (file: FileEntry) => FileEntry | null;
export type FolderEdit = (folders: FolderEntry[]) => FolderEntry[];

export function editLibraryCache(
  cache: LibraryCache | undefined,
  edit: { files?: FileEdit; deletedFolderId?: string },
): LibraryCache | undefined {
  if (!cache) return cache;
  const { files: editFile, deletedFolderId } = edit;
  return {
    ...cache,
    pages: cache.pages.map((page) => ({
      ...page,
      files: editFile
        ? page.files.flatMap((file) => {
            const kept = editFile(file);
            return kept ? [kept] : [];
          })
        : page.files,
      deletedFolders:
        deletedFolderId === undefined
          ? page.deletedFolders
          : page.deletedFolders?.filter((folder) => folder.id !== deletedFolderId),
    })),
  };
}

export function dropFiles(ids: readonly string[]): FileEdit {
  const dropped = new Set(ids);
  return (file) => (dropped.has(file.id) ? null : file);
}

export function renameFileRow(id: string, filename: string): FileEdit {
  return (file) => (file.id === id ? { ...file, filename } : file);
}

export function removeFolderTrees(paths: readonly string[]): FolderEdit {
  return (folders) =>
    folders.filter((folder) => !paths.some((path) => isWithin(path, folder.path)));
}

function retargetTree(folders: FolderEntry[], from: string, to: string): FolderEntry[] {
  return folders.map((folder) =>
    isWithin(from, folder.path)
      ? {
          ...folder,
          path: rewritePrefix(folder.path, from, to),
          name: folder.path === from ? basename(to) : folder.name,
        }
      : folder,
  );
}

export function renameFolderTree(path: string, name: string): FolderEdit {
  return (folders) => retargetTree(folders, path, joinPath(parentPath(path), name));
}

export function moveFolderTrees(paths: readonly string[], destination: string): FolderEdit {
  return (folders) =>
    paths.reduce(
      (next, path) => retargetTree(next, path, joinPath(destination, basename(path))),
      folders,
    );
}
