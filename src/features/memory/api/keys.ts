// Workspace roots prevent cache reads across tenants. List invalidation covers browse and trash,
// while individual notes survive overlay unmounts so reopening does not flash a loading state.
export const memoryQueryKeys = {
  versions: (organizationId: string, scope: string, noteId: string) =>
    ['memory', organizationId, 'versions', scope, noteId] as const,
  version: (organizationId: string, scope: string, versionId: string | null) =>
    ['memory', organizationId, 'version', scope, versionId] as const,
  all: (organizationId: string) => ['memory', organizationId] as const,
  /** Root over every browse/trash list — invalidate this to reconcile the drive. */
  list: (organizationId: string) => ['memory', organizationId, 'list'] as const,
  /** One Browse folder: the notes + subfolders directly inside a store path. */
  browse: (organizationId: string, scope: string, folderPath: string) =>
    ['memory', organizationId, 'list', 'browse', scope, folderPath] as const,
  /** Every loaded Browse folder of one store. */
  browseScope: (organizationId: string, scope: string) =>
    ['memory', organizationId, 'list', 'browse', scope] as const,
  /** One store's Recently-deleted list. */
  trash: (organizationId: string, scope: string) =>
    ['memory', organizationId, 'list', 'trash', scope] as const,
  note: (organizationId: string, scope: string, id: string) =>
    ['memory', organizationId, 'note', scope, id] as const,
};
