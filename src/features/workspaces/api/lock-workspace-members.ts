import { and, eq, sql } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import { member } from '@/db/schema';
import type { Caller } from '@/lib/caller';
import { AppError } from '@/lib/errors';

export async function lockWorkspaceMembers(tx: DbTransaction, caller: Caller) {
  const { organizationId, userId } = caller;

  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 5))`);
  // Owner locks serialize role changes and removals before either reads the actor.
  const owners = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .for('update');

  const actor = (
    await tx
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      .limit(1)
  ).at(0);
  if (!actor) {
    throw new AppError('WORKSPACE_NOT_FOUND', 'Actor is not a member of the active workspace', {
      organizationId,
      userId: userId,
    });
  }

  return { organizationId, owners, actor };
}
