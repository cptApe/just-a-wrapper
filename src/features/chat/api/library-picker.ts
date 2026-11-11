'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { isValidFolderPath, parentPath, ROOT } from '@/features/files/lib/paths';
import { ensureTeamFolder } from '@/features/files/lib/team-folder';
import { loadFilesInFolder, loadFolderCounts, loadFolders } from '@/features/files/server';
import type { ComposerLibraryFile, ComposerLibraryFolder } from '@/features/sessions/types';
import { resolveCaller } from '@/lib/caller';
import { withRequestContext } from '@/lib/request-context';

// Server action behind the composer's "Add from library" canvas picker. The
// canvas loads its own data per folder path on open/navigation (Foundations/
// Overlays: "each loads its own data") — full parity with the Library page
// browser: folders (navigable + selectable) and files at that path. Workspace is
// re-resolved from the session (never trusted from the client — the abuse
// boundary for reads). Client code imports this FILE directly; the chat barrel
// re-exports client components.

export type ComposerLibraryListing = {
  folders: ComposerLibraryFolder[];
  files: ComposerLibraryFile[];
};

// An unknown-but-valid path simply yields an empty listing (no cross-workspace
// leak — every query is workspace-scoped); a malformed path is rejected here.
const PathInput = z
  .string()
  .max(1024)
  .refine(isValidFolderPath, { message: 'invalid folder path' });

export async function loadComposerLibrary(path: string): Promise<ComposerLibraryListing> {
  return withRequestContext({ route: 'chat/composer-library', feature: 'chat' }, async () => {
    const requested = PathInput.parse(path);
    const { workspaceId, userId } = await resolveCaller(await headers());
    // Ensure the shared Team folder exists so it's always reachable from the
    // composer picker too, even on a workspace where nobody has opened Library.
    await ensureTeamFolder(workspaceId, userId);

    const [allFolders, counts, filesInFolder] = await Promise.all([
      loadFolders(workspaceId, userId),
      loadFolderCounts(workspaceId, userId),
      loadFilesInFolder(workspaceId, requested, userId),
    ]);

    const folders: ComposerLibraryFolder[] = allFolders
      .filter((f) => f.path !== ROOT && parentPath(f.path) === requested)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => ({ path: f.path, name: f.name, itemCount: counts[f.path] ?? 0 }));

    const files: ComposerLibraryFile[] = filesInFolder
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((f) => ({
        id: f.id,
        name: f.filename,
        url: f.url,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
      }));

    return { folders, files };
  });
}
