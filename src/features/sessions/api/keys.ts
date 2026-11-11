// Workspace-rooted query keys keep tenant caches separate and let invalidation reach every session
// query for one workspace.
export const sessionQueryKeys = {
  root: ['sessions'] as const,
  all: (organizationId: string) => ['sessions', organizationId] as const,
  list: (organizationId: string) => [...sessionQueryKeys.all(organizationId), 'list'] as const,
} as const;
