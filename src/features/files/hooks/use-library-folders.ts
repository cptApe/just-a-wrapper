import * as React from 'react';
import { IconUsers01 } from '@/components/icons';
import type { BrowserItem } from '../components/browser/types';
import { type SortSpec, sortFolders } from '../lib/library-items';
import { parentPath, ROOT, TEAM_FOLDER_PATH } from '../lib/paths';
import type { FolderEntry } from '../types';
export function useLibraryFolders({
  trash,
  deletedFolders,
  browsing,
  folders,
  path,
  sort,
  showTeamFolder,
}: {
  trash: boolean;
  deletedFolders: FolderEntry[];
  browsing: boolean;
  folders: FolderEntry[];
  path: string;
  sort: SortSpec;
  showTeamFolder: boolean;
}) {
  const visibleFolders = React.useMemo(() => {
    if (trash) return sortFolders(deletedFolders, sort);
    if (!browsing) return [];
    return sortFolders(
      folders.filter(
        // The Team folder renders pinned separately at root — keep it out of the
        // normal folder list so it never appears twice.
        (f) => f.path !== ROOT && f.path !== TEAM_FOLDER_PATH && parentPath(f.path) === path,
      ),
      sort,
    );
  }, [trash, deletedFolders, browsing, folders, path, sort]);

  // The shared Team folder is pinned first at the Library root: a distinct
  // people-glyph tile whose count slot reads "Shared with your team". Dropping a
  // file on it shares it; it can't be selected, renamed, moved, or deleted.
  const pinnedTeamItem = React.useMemo((): BrowserItem | null => {
    if (!browsing || path !== ROOT || !showTeamFolder) return null;
    const teamRow = folders.find((f) => f.path === TEAM_FOLDER_PATH);
    return {
      key: `folder:${TEAM_FOLDER_PATH}`,
      kind: 'folder',
      name: 'Team',
      caption: 'Shared with your team',
      modifiedAt: teamRow?.createdAt ?? null,
      sizeBytes: null,
      kindLabel: 'Folder',
      imageSrc: null,
      glyph: IconUsers01,
      selectable: false,
      dropTargetPath: TEAM_FOLDER_PATH,
      menu: [],
    };
  }, [browsing, path, folders, showTeamFolder]);

  return { visibleFolders, pinnedTeamItem };
}
