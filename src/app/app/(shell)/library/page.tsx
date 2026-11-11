import { headers } from 'next/headers';
import { createLoader, type SearchParams } from 'nuqs/server';
import { Boundary } from '@/components/layouts/boundary';
import { ErrorState } from '@/components/layouts/error-state';
import { PageBody, PageHeader, PageShell } from '@/components/layouts/page-shell';
import { filesQueryKey } from '@/features/files';
import { libraryParsers, normalizeLibraryParams } from '@/features/files/lib/library-search-params';
import { ensureTeamFolder } from '@/features/files/lib/team-folder';
import {
  loadEditableFolderPaths,
  loadFilesPage,
  loadFolderCounts,
  loadFolders,
  uploadConfig,
} from '@/features/files/server';
import { loadMemorySurface } from '@/features/memory';
import { NOTE_ROOT } from '@/features/memory/lib/notes';
import { readVirtualPath } from '@/features/memory/lib/virtual-path';
import { countWorkspaceSeats } from '@/features/workspaces/server';
import { brand } from '@/lib/brand/identity';
import { resolveCaller } from '@/lib/caller';
import { withRequestContext } from '@/lib/request-context';
import { roleIsAtLeast } from '@/lib/workspace-role';
import { LibraryIsland } from './library-island';
import { LibraryPageSkeleton } from './library-page-skeleton';

export const metadata = {
  title: `${brand.name} · library`,
};

const loadLibrarySearchParams = createLoader(libraryParsers);

// Parse Library query state once and seed the first matching page into the island.
// Cold links render their requested view; shallow refinements refetch through pane actions.
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = normalizeLibraryParams(await loadLibrarySearchParams(searchParams));
  return (
    <PageShell width="reading">
      <Boundary loading={<LibraryPageSkeleton />} error={<LibraryError />}>
        <LibraryLoader params={params} />
      </Boundary>
    </PageShell>
  );
}

async function LibraryLoader({
  params,
}: {
  params: Awaited<ReturnType<typeof loadLibrarySearchParams>>;
}) {
  const data = await withRequestContext({ route: 'library', feature: 'files' }, async () => {
    const h = await headers();
    const { workspaceId, organizationId, userId, role } = await resolveCaller(h);
    // Make the shared Team folder real before we list: it renders pinned first
    // at root and must be a live, navigable, move-targetable row for everyone.
    await ensureTeamFolder(workspaceId, userId);
    const filesQuery = {
      path: params.tab === 'files' ? params.path : '/',
      type: params.type,
      q: params.tab === 'files' ? params.q : '',
      trash: params.tab === 'files' && params.trash,
      sort: params.sort,
      dir: params.dir,
    };
    // At the virtual root or on Files, load memory access flags without upstream reads.
    // A direct Memory store-root link seeds that store’s first page server-side.
    // Deeper folders, other stores and trash fetch through the client actions.
    const mem = readVirtualPath(params.path);
    const seedMemory = params.tab === 'memory' && mem.scope !== null && mem.storePath === NOTE_ROOT;
    const [folders, folderCounts, initialPage, editableFolderPaths, memory, seats] =
      await Promise.all([
        loadFolders(workspaceId, userId),
        loadFolderCounts(workspaceId, userId),
        loadFilesPage(workspaceId, userId, { ...filesQuery, offset: 0 }),
        loadEditableFolderPaths(workspaceId, userId),
        loadMemorySurface(h, mem.scope ?? params.scope, { accessOnly: !seedMemory }),
        // Seats live on the Better Auth organization, not the workspace row.
        countWorkspaceSeats(organizationId),
      ]);
    return {
      files: {
        organizationId,
        workspaceId,
        folders,
        folderCounts,
        initialPage,
        initialQueryKey: filesQueryKey(filesQuery),
        uploadConfig: await uploadConfig(null),
        canAdministerWorkspace: roleIsAtLeast(role, 'admin'),
        editableFolderPaths,
        // A one-person workspace has nobody to share with, so the pinned Team
        // folder stays hidden until a second member or a pending invite exists.
        showTeamFolder: seats.members + seats.pendingInvitations > 1,
      },
      memory,
    };
  });

  return <LibraryIsland files={data.files} memory={data.memory} />;
}

function LibraryError() {
  return (
    <>
      <PageHeader title="Library" />
      <PageBody>
        <ErrorState
          title="Couldn’t load your library"
          message="Something went wrong reading this workspace. Reload the page to try again."
        />
      </PageBody>
    </>
  );
}
