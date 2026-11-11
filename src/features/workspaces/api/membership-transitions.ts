import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import { member } from '@/db/schema';
import { revokeMemberWorkspaceAccess } from './revoke-member-workspace-access';

/** A missing row is terminal; accepting another invitation creates a new membership. */
export async function removeMembership(tx: DbTransaction, organizationId: string, userId: string) {
  const removed = await tx
    .delete(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .returning({ id: member.id });
  if (removed.length === 0) return false;
  await revokeMemberWorkspaceAccess(tx, organizationId, userId);
  return true;
}
