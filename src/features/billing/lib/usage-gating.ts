export type UsageGating = {
  effectiveUserId: string | null;
  requestedMember: string | null;
  showRemaining: boolean;
  showByMember: boolean;
};

// Discard non-admin member filters and force their own identity so URLs cannot expose colleagues' usage.
export function resolveUsageGating(input: {
  isAdmin: boolean;
  ownUserId: string;
  requestedMember: string | null;
}): UsageGating {
  const requestedMember = input.isAdmin ? input.requestedMember?.trim() || null : null;
  const effectiveUserId = input.isAdmin ? requestedMember : input.ownUserId;
  return {
    effectiveUserId,
    requestedMember,
    showRemaining: input.isAdmin && requestedMember === null,
    showByMember: input.isAdmin,
  };
}
