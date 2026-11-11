// Files keys root on the active organization id, the client's tenant scope. A workspace
// switch is a soft refresh that keeps the QueryClient, so this root keeps one workspace's
// files out of another's view, and `all(organizationId)` clears them all at once.
export const fileQueryKeys = {
  uploadContext: (organizationId: string) =>
    [...fileQueryKeys.all(organizationId), 'upload-context'] as const,
  shares: (organizationId: string, target: string) =>
    [...fileQueryKeys.all(organizationId), 'shares', target] as const,
  all: (organizationId: string) => ['files', organizationId] as const,
  lists: (organizationId: string) => [...fileQueryKeys.all(organizationId), 'list'] as const,
  list: (organizationId: string, params: string) =>
    [...fileQueryKeys.all(organizationId), 'list', params] as const,
  text: (organizationId: string, url: string) =>
    [...fileQueryKeys.all(organizationId), 'text', url] as const,
  // Anonymous shares have no active workspace; their complete bearer URL isolates each preview.
  sharedText: (url: string) => ['files', 'shared-text', url] as const,
  // Inert key for the "no workspace resolved yet" state. The query is disabled
  // whenever it is used, so it never executes or caches — it exists only to give
  // useQuery a required key without ever substituting a real workspace's bucket.
  unscoped: () => ['files', '__unscoped__'] as const,
} as const;

// Artifact keys root on the organization id like every other key, so one invalidate clears them.
export const artifactQueryKeys = {
  all: (organizationId: string) => ['artifacts', organizationId] as const,
  session: (organizationId: string, sessionId: string) =>
    [...artifactQueryKeys.all(organizationId), 'session', sessionId] as const,
  text: (organizationId: string, artifactId: string) =>
    [...artifactQueryKeys.all(organizationId), 'text', artifactId] as const,
  // Inert key for the "no workspace resolved yet" state. The query is disabled
  // whenever it is used, so it never executes or caches — it exists only to give
  // useQuery a required key without ever substituting a real workspace's bucket.
  unscoped: () => ['artifacts', '__unscoped__'] as const,
} as const;
