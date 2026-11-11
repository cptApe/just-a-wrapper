export const chatQueryKeys = {
  status: (sessionId: string) => ['chat', sessionId, 'status'] as const,
  library: (organizationId: string | null, resource: string) =>
    ['chat', organizationId, 'library', resource] as const,
  sharing: (sessionId: string) => ['chat', sessionId, 'sharing'] as const,
  feedback: (sessionId: string) => ['chat', sessionId, 'feedback'] as const,
  composerLibrary: (organizationId: string | null, path: string) =>
    ['chat', organizationId, 'composer-library', path] as const,
  composerSkills: (organizationId: string | null, sessionId: string | undefined) =>
    ['chat', organizationId, 'composer-skills', sessionId ?? 'new-chat'] as const,
  context: (organizationId: string, sessionId: string) =>
    ['chat', organizationId, 'context', sessionId] as const,
};

export const customToolsKeys = {
  pending: (organizationId: string, sessionId: string) =>
    ['custom-tools', organizationId, sessionId, 'pending'] as const,
  // Inert key for the "no workspace resolved yet" state — the query is disabled
  // whenever it is used, so it never executes or caches (mirrors the feature
  // factories' `unscoped`).
  pendingUnscoped: (sessionId: string) =>
    ['custom-tools', '__unscoped__', sessionId, 'pending'] as const,
};
