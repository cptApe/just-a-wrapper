// The admin console has no workspace: its reads are the deployment's own.
export const adminQueryKeys = {
  all: () => ['admin'] as const,
  /** The bytes the Open Graph route returns, shown on the Brand page. */
  openGraphImage: () => [...adminQueryKeys.all(), 'open-graph-image'] as const,
} as const;
