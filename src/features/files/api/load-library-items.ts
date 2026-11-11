import 'server-only';
import { listWorkspaceArtifacts } from './list-artifacts';
import { loadFiles } from './load';

// Hash overlays resolve independently of the underlying page, so they need the
// whole Library. The session title rides along as the preview's "from …" line.
export async function loadLibraryItems(workspaceId: string, userId: string) {
  const [files, artifactGroups] = await Promise.all([
    loadFiles(workspaceId, userId),
    listWorkspaceArtifacts({ workspaceId, viewerId: userId }),
  ]);
  const artifacts = artifactGroups.flatMap((group) =>
    group.artifacts.map((artifact) => ({
      ...artifact,
      sessionTitle: group.title,
      sessionRowId: group.sessionRowId,
    })),
  );
  return { files, artifacts };
}
