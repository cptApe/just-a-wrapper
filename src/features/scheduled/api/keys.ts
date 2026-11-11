// Workspace IDs are the tenant boundary; list and detail keys must never cross workspaces.

export const scheduledQueryKeys = {
  connections: (organizationId: string) => ['integrations', organizationId, 'connections'] as const,
  uploadConfig: () => ['files', 'upload-config'] as const,
  all: (organizationId: string) => ['scheduled', organizationId] as const,
  list: (organizationId: string) => [...scheduledQueryKeys.all(organizationId), 'list'] as const,
  notifications: (organizationId: string) =>
    [...scheduledQueryKeys.all(organizationId), 'notifications'] as const,
  detail: (organizationId: string, taskId: string) =>
    [...scheduledQueryKeys.all(organizationId), 'detail', taskId] as const,
  summary: (organizationId: string, taskId: string) =>
    [...scheduledQueryKeys.all(organizationId), 'summary', taskId] as const,
  // Inert key for the "no workspace resolved yet" state (mirrors
  // src/lib/search-query-keys.ts). The detail query is disabled whenever it is used, so
  // this never executes or caches — it just gives useQuery a required key without
  // rooting on an empty-string workspace that could collide across tenants.
  unscoped: () => ['scheduled', '__unscoped__'] as const,
} as const;
