// React Query key factory for integrations. Rooted on the
// workspace (the active organizationId on the client — the tenant boundary).
// `actions(organizationId, slug)` keys one toolkit's action
// list; caching it (staleTime Infinity for a successful read) is the session
// cache — reopening an app renders its actions instantly instead of re-running
// the server action.
export const integrationQueryKeys = {
  all: (organizationId: string) => ['integrations', organizationId] as const,
  actions: (organizationId: string, slug: string) =>
    [...integrationQueryKeys.all(organizationId), 'actions', slug] as const,
  /** One toolkit's live connection status; read again on every open. */
  status: (organizationId: string, slug: string) =>
    [...integrationQueryKeys.all(organizationId), 'status', slug] as const,
  // Inert key for the "no workspace resolved yet" state — the query is disabled
  // whenever it is used, so it never executes or caches; it exists only to give
  // useQuery a required key without substituting a real workspace's bucket.
  unscoped: (slug: string) => ['integrations', '__unscoped__', 'actions', slug] as const,
} as const;
