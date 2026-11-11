import 'server-only';
import { parentPath } from '../lib/paths';
import { ensureTeamFolder, isTeamPath } from '../lib/team-folder';
import type { FileEntry, FolderEntry } from '../types';
import { loadFilesInFolder, loadFolders } from './load';

// One level of a workspace's Library at `folderPath`: the files directly inside
// it plus its direct child folders. Both reads are workspace-scoped at the DB
// (loadFilesInFolder / loadFolders both filter on workspaceId), so a caller can
// only ever see the given workspace's Library. `viewerId` further scopes to that
// user's own files plus the shared Team subtree (private-by-default privacy).
// `folderPath` must already be normalized + validated by the caller (the tool
// executor is the trust gate). Backs the `list_library_folder` custom tool's
// pull-on-demand model.

export type LibraryFolderListing = { files: FileEntry[]; folders: FolderEntry[] };

export async function listLibraryFolder(
  workspaceId: string,
  viewerId: string,
  folderPath: string,
): Promise<LibraryFolderListing> {
  if (isTeamPath(folderPath)) await ensureTeamFolder(workspaceId, viewerId);
  const [files, allFolders] = await Promise.all([
    loadFilesInFolder(workspaceId, folderPath, viewerId),
    loadFolders(workspaceId, viewerId),
  ]);
  const folders = allFolders.filter((f) => parentPath(f.path) === folderPath);
  return { files, folders };
}
