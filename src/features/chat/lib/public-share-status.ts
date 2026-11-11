// Explicit .ts + relative path (not the `@/` alias) so this module stays runnable
// under Node's type-stripping test runner (tool-display.ts precedent).
import { type PublicLinkLiveness, publicLinkState } from '@/lib/share-token';

// The public status of a task-share row at request time. Extends public link
// liveness with the thread's soft-delete state: a hidden (deleted) task's link is
// dead — it must show the plain notice, never a stale transcript, even while a
// non-revoked share row still exists. Pure (clock + hiddenAt injected) so the
// security-relevant decision is unit-tested.
type PublicShareStatus = 'revoked' | 'expired' | 'live';

export function publicShareStatus(
  input: PublicLinkLiveness & { hiddenAt: Date | null },
  now: Date,
): PublicShareStatus {
  // Soft-deleted thread → treat the link as revoked (dead), regardless of the
  // share row's own liveness.
  if (input.hiddenAt !== null) return 'revoked';
  return publicLinkState(input, now);
}
