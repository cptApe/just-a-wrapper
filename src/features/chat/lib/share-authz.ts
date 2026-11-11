// Explicit .ts + relative path (not the `@/` alias) so this module stays runnable
// under Node's type-stripping test runner (tool-display.ts precedent).
import { AppError } from '@/lib/errors';

// Ownership gate for task sharing. The sharer must be the thread's CREATOR, not
// merely a member of its workspace — "only me" is the owner's call. A missing row
// (foreign/unknown thread) and a non-creator workspace member both throw the SAME
// SESSION_NOT_FOUND, so neither a thread's existence nor its ownership leaks to a
// non-owner (same IDOR contract as the sessions feature's access gate).
export function assertThreadOwner(
  row: { id: string; createdByUserId: string } | undefined,
  userId: string,
  context: Record<string, unknown>,
): string {
  if (!row || row.createdByUserId !== userId) {
    throw new AppError('SESSION_NOT_FOUND', 'session not found', context);
  }
  return row.id;
}
