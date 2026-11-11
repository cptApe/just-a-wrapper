export const notificationKeys = {
  preferences: (userId: string | null) => ['notification-preferences', userId] as const,
  all: (organizationId: string | null, userId: string | null) =>
    ['notifications', organizationId, userId] as const,
  feed: (organizationId: string | null, userId: string | null, filter: string) =>
    [...notificationKeys.all(organizationId, userId), filter] as const,
};
