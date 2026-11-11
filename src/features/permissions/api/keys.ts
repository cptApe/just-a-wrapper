// Rooted on the workspace so a switch never shows one workspace's choices in another.
export const permissionQueryKeys = {
  all: (organizationId: string) => ['permissions', organizationId] as const,
  /** One toolkit's saved per-tool policies and settings for the signed-in member. */
  toolkit: (organizationId: string, slug: string) =>
    [...permissionQueryKeys.all(organizationId), 'toolkit', slug] as const,
} as const;
