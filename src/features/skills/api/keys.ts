// Active organization IDs isolate cache entries across workspace switches. Prefetch and queries
// use these same keys so a warmed inspector is a cache hit.
export const skillQueryKeys = {
  all: (organizationId: string) => ['skills', organizationId] as const,
  list: (organizationId: string) => [...skillQueryKeys.all(organizationId), 'list'] as const,
  detail: (organizationId: string, skillId: string) =>
    [...skillQueryKeys.all(organizationId), 'detail', skillId] as const,
  // Inert key for the "no workspace resolved yet" state — the detail query is
  // disabled whenever it is used, so it never executes or caches; it exists only
  // to give useQuery a required key without bucketing under a real workspace.
  unscoped: (skillId: string) => ['skills', '__unscoped__', 'detail', skillId] as const,
} as const;
