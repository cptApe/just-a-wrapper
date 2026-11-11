// Each query text has a bounded cache, isolated by workspace.
export const SEARCH_STALE_TIME_MS = 30_000;
export const SEARCH_GC_TIME_MS = 5 * 60_000;

export const searchQueryKeys = {
  all: (organizationId: string) => ['search', organizationId] as const,
  results: (organizationId: string, query: string) =>
    [...searchQueryKeys.all(organizationId), 'results', query] as const,
  memory: (organizationId: string, query: string) =>
    [...searchQueryKeys.all(organizationId), 'memory', query] as const,
  // Disabled observers release the prior query for GC and never share a real workspace’s cache bucket.
  unscoped: () => ['search', '__unscoped__'] as const,
} as const;
