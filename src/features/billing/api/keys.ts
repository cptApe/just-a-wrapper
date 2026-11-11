// The saved card decides how a purchase runs, so each open refetches these entries.
export const billingQueryKeys = {
  all: (organizationId: string) => ['billing', organizationId] as const,
  topupOptions: (organizationId: string) =>
    [...billingQueryKeys.all(organizationId), 'topup-options'] as const,
  /** The balance and plan the composer reads before a send. */
  composerCredits: (organizationId: string) =>
    [...billingQueryKeys.all(organizationId), 'composer-credits'] as const,
  /** Plans for sale and the workspace's current plan, read fresh on every open. */
  planOptions: (organizationId: string) =>
    [...billingQueryKeys.all(organizationId), 'plan-options'] as const,
  /** The exact charge for one plan change, read fresh each time it is confirmed. */
  planPreview: (organizationId: string, choice: string) =>
    [...billingQueryKeys.all(organizationId), 'plan-preview', choice] as const,
  /** The one plan purchase or change in flight. */
  plan: (organizationId: string) => [...billingQueryKeys.all(organizationId), 'plan'] as const,
  /** The one credit purchase in flight; a second click while it runs is ignored. */
  topup: (organizationId: string) => [...billingQueryKeys.all(organizationId), 'topup'] as const,
} as const;
