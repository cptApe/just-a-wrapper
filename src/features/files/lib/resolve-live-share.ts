import type { FileEntry, ResolvedShare, ShareMode } from '../types';

/** Shape public content without allowing a file link to expose sibling files. */
export function resolveLiveShare(
  share: {
    fileId: string | null;
    mode: ShareMode;
    folderPath: string;
    workspaceId: string;
    workspaceName: string;
  },
  files: FileEntry[],
): ResolvedShare {
  const workspace = { workspaceId: share.workspaceId, workspaceName: share.workspaceName };
  if (share.fileId !== null) {
    const file = files.find((candidate) => candidate.id === share.fileId && !candidate.deletedAt);
    if (!file || share.mode !== 'view') return { status: 'not_found' };
    return { status: 'live', kind: 'file', mode: 'view', ...workspace, file };
  }
  return {
    status: 'live',
    kind: 'folder',
    ...workspace,
    mode: share.mode,
    folderPath: share.folderPath,
    files,
  };
}
