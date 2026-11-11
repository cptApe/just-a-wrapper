export const STALE_SESSION_SECONDS = 50;
// User events are non-idempotent; an ambiguous send is reconciled from the provider log.
export const SESSION_SEND_OPTIONS = { timeout: 30_000, maxRetries: 0 };
