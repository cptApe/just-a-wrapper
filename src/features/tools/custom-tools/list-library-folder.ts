import 'server-only';
import { z } from 'zod';
import { listLibraryFolder } from '@/features/files/server';
import { LIST_LIBRARY_FOLDER_DECL } from '@/features/tool-catalog/library-declarations';
import type { CustomTool } from '@/features/tool-catalog/types';
import { resolveLibraryPath, toLibraryEntries } from '../lib/library-listing';

// Executor for `list_library_folder`. Read-only (riskLevel 'safe'). Two guards
// make this the trust boundary:
//   1. Path validation: normalizeFolderPath rejects traversal ('.'/'..') and
//      bad segments. An un-normalizable path returns an EMPTY listing with a
//      clear message, never an error dump.
//   2. Tenant scoping: it lists ONLY ctx.workspaceId's Library — listLibraryFolder
//      filters both files and folders on that workspace id at the DB, so a
//      session can never see another workspace's Library, whatever path it asks
//      for.
// Files carry their Library path (read with read_library_file); subfolders carry
// their path (recurse by calling again).

const input = z.object({ path: z.string() });

const entry = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(['file', 'folder']),
  size: z.number().optional(),
  url: z.string().optional(),
});
const output = z.object({
  path: z.string(),
  entries: z.array(entry),
  message: z.string().optional(),
});

export const listLibraryFolderTool: CustomTool<z.infer<typeof input>, z.infer<typeof output>> = {
  ...LIST_LIBRARY_FOLDER_DECL,
  inputSchema: input,
  outputSchema: output,
  async handler({ path }, ctx) {
    const resolved = resolveLibraryPath(path);
    if (resolved.message) {
      return { path: resolved.path, entries: [], message: resolved.message };
    }

    // Tenant scoping: listLibraryFolder always filters on ctx.workspaceId; the
    // path never touches that filter, so a session can only ever see its own
    // workspace's Library. Visibility is further scoped to the acting user
    // (ctx.userId) plus the shared Team subtree — the agent sees the same
    // private-by-default Library its user does.
    const listing = await listLibraryFolder(ctx.workspaceId, ctx.userId, resolved.path);
    const entries = toLibraryEntries(resolved.path, listing);

    return {
      path: resolved.path,
      entries,
      ...(entries.length === 0 ? { message: `No files or folders in "${resolved.path}".` } : {}),
    };
  },
};
