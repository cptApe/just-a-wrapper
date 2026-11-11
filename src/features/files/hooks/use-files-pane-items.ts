'use client';

import * as React from 'react';
import {
  IconCornerUpRight,
  IconFlipBackward,
  IconFolder,
  IconLink01,
  IconPencil01,
  IconTrash01,
} from '@/components/icons';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { formatBytes } from '@/lib/format/format-bytes';
import { formatDate } from '@/lib/format/format-date';
import { plural } from '@/lib/format/plural';
import { deleteFiles } from '../api/delete-files';
import { deleteFolder } from '../api/folders';
import { restoreFiles, restoreFolder } from '../api/restore';
import type { BrowserItem, BrowserMenuEntry } from '../components/browser/types';
import { fileGlyphTone, fileKindGlyph } from '../components/file-kind-icon';
import type { MoveTarget } from '../components/files-pane-selection';
import { createFileMenu } from '../components/library-file-menu';
import { displayFilename, fileExtensionBadge, isImageMime, isVideoMime } from '../lib/file-types';
import { dropFiles, removeFolderTrees } from '../lib/library-cache';
import { isWithin } from '../lib/paths';
import type { FileEntry, FolderEntry, ShareTarget } from '../types';
import type { RunLibraryWrite } from './use-library-writes';

type ItemHandlers = {
  path: string;
  openPath: (value: string | null) => void;
  run: RunLibraryWrite;
  startRename: (key: string) => void;
  openMove: (target: MoveTarget) => void;
  openShare: (target: ShareTarget) => void;
};

export function useFilesPaneItems({
  trash,
  files,
  folderCounts,
  visibleFolders,
  pinnedTeamItem,
  path,
  openPath,
  run,
  startRename,
  openMove,
  openShare,
}: ItemHandlers & {
  trash: boolean;
  files: FileEntry[];
  folderCounts: Record<string, number>;
  visibleFolders: FolderEntry[];
  pinnedTeamItem: BrowserItem | null;
}): BrowserItem[] {
  const { timeZone } = useDisplayFormat();
  return React.useMemo(() => {
    const folderItems = visibleFolders.map((folder): BrowserItem => {
      const count = folderCounts[folder.path] ?? 0;
      return {
        key: `folder:${folder.path}`,
        kind: 'folder',
        name: folder.name,
        caption: trash
          ? `Deleted ${formatDate(folder.deletedAt ?? folder.createdAt, timeZone)}`
          : plural(count, 'item'),
        modifiedAt: trash ? (folder.deletedAt ?? folder.createdAt) : folder.createdAt,
        sizeBytes: null,
        kindLabel: 'Folder',
        imageSrc: null,
        glyph: IconFolder,
        selectable: !trash,
        dropTargetPath: trash ? undefined : folder.path,
        menu: trash
          ? [
              {
                kind: 'action',
                id: 'restore',
                label: 'Restore',
                icon: IconFlipBackward,
                onSelect: () =>
                  run({
                    action: () => restoreFolder(folder.id),
                    success: 'Folder restored',
                    failure: 'Couldn’t restore the folder',
                    deletedFolderId: folder.id,
                  }),
              },
            ]
          : folderMenu(folder, {
              path,
              openPath,
              run,
              startRename,
              openMove,
              openShare,
            }),
      };
    });
    const fileItems = files.map((file): BrowserItem => {
      const typeLabel = fileExtensionBadge(file.mimeType, file.filename);
      return {
        key: `file:${file.id}`,
        kind: 'doc',
        name: displayFilename(file.filename),
        renameName: file.filename,
        caption: trash
          ? `Deleted ${formatDate(file.deletedAt ?? file.createdAt, timeZone)}`
          : `${typeLabel} • ${formatBytes(file.sizeBytes)}`,
        modifiedAt: file.createdAt,
        sizeBytes: file.sizeBytes,
        kindLabel: typeLabel,
        imageSrc: isImageMime(file.mimeType) ? file.url : null,
        videoSrc: isVideoMime(file.mimeType) ? file.url : null,
        playBadge: isVideoMime(file.mimeType),
        glyph: fileKindGlyph(file.mimeType, file.filename),
        glyphTone: fileGlyphTone(file.mimeType, file.filename),
        selectable: !trash,
        menu: trash
          ? [
              {
                kind: 'action',
                id: 'restore',
                label: 'Restore',
                icon: IconFlipBackward,
                onSelect: () =>
                  run({
                    action: () => restoreFiles([file.id]),
                    success: 'File restored',
                    failure: 'Couldn’t restore the file',
                    files: dropFiles([file.id]),
                  }),
              },
            ]
          : createFileMenu(file, {
              rename: () => startRename(`file:${file.id}`),
              move: () => openMove({ fileIds: [file.id], folderPaths: [] }),
              share: () => openShare({ kind: 'file', fileId: file.id, filename: file.filename }),
              remove: () =>
                run({
                  action: () => deleteFiles([file.id]),
                  success: 'File deleted',
                  failure: 'Couldn’t delete the file',
                  files: dropFiles([file.id]),
                }),
            }),
      };
    });
    return [...(pinnedTeamItem ? [pinnedTeamItem] : []), ...folderItems, ...fileItems];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- menus close over stable handlers
  }, [pinnedTeamItem, visibleFolders, files, folderCounts, trash, timeZone]);
}

function folderMenu(
  folder: FolderEntry,
  { path, openPath, run, startRename, openMove, openShare }: ItemHandlers,
): BrowserMenuEntry[] {
  return [
    {
      kind: 'action',
      id: 'rename',
      label: 'Rename',
      icon: IconPencil01,
      onSelect: () => startRename(`folder:${folder.path}`),
    },
    {
      kind: 'action',
      id: 'move',
      label: 'Move to…',
      icon: IconCornerUpRight,
      onSelect: () => openMove({ fileIds: [], folderPaths: [folder.path] }),
    },
    {
      kind: 'action',
      id: 'share',
      label: 'Share',
      icon: IconLink01,
      onSelect: () => openShare({ kind: 'folder', folderPath: folder.path }),
    },
    { kind: 'separator', id: 'sep' },
    {
      kind: 'action',
      id: 'delete',
      label: 'Delete',
      icon: IconTrash01,
      destructive: true,
      onSelect: () =>
        run({
          action: () => deleteFolder(folder.path),
          success: 'Folder deleted',
          failure: 'Couldn’t delete the folder',
          folders: removeFolderTrees([folder.path]),
          after: () => {
            if (isWithin(folder.path, path)) openPath(null);
          },
        }),
    },
  ];
}
