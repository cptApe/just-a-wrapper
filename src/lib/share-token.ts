import { randomBytes } from 'node:crypto';

// Public share-token generation + liveness resolution, shared by the folder-share
// (features/files) and task-share (features/chat) slices. Pure (no errors.ts, no
// db) so the resolution logic — the security-critical part — is unit-testable
// under `node --test`. Lives in src/lib (not a feature) because two features
// depend on it; reaching across a feature barrel for it would be a house-rule
// violation.

/**
 * A url-safe, unguessable share token. 32 bytes of entropy, base64url-encoded
 * (~43 chars). Collisions are astronomically unlikely; the DB UNIQUE on each
 * share table's `token` is the backstop.
 */
export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

// The fields of a share row that determine whether the link is usable.
export type ShareLiveness = {
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type ShareState = 'live' | 'revoked' | 'expired';

/**
 * Resolve a share's state at `now`. Revocation wins over expiry (an explicitly
 * killed link reads as revoked even if it would also have expired). A null
 * `expiresAt` never expires.
 */
export function shareState(share: ShareLiveness, now: Date): ShareState {
  if (share.revokedAt !== null) return 'revoked';
  if (share.expiresAt !== null && share.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'live';
}

/** Convenience boolean used by the resolvers + edit-share upload gate. */
export function isShareLive(share: ShareLiveness, now: Date): boolean {
  return shareState(share, now) === 'live';
}

// Deleting a workspace keeps its share rows for the retention window, so every
// public resolver reads the workspace lifecycle here rather than trusting the row.
export type PublicLinkLiveness = ShareLiveness & { workspaceLive: boolean };

/** The state a public link resolves to: a link in a workspace that is not live reads revoked. */
export function publicLinkState(link: PublicLinkLiveness, now: Date): ShareState {
  if (!link.workspaceLive) return 'revoked';
  return shareState(link, now);
}
