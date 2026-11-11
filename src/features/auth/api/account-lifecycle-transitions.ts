import { and, eq, inArray, lt } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import { user } from '@/db/schema';
import { accountLifecycleMachine } from '../lib/account-lifecycle-machine';

export async function tombstoneAccount(
  tx: DbTransaction,
  userId: string,
  email: string,
  now: Date,
) {
  const moved = await tx
    .update(user)
    .set({
      accountStatus: 'deleted',
      email: `deleted+${userId}@deleted.agentcore.local`,
      deletedEmail: email,
      deletedAt: now,
      name: 'Deleted account',
      image: null,
    })
    .where(
      and(
        eq(user.id, userId),
        inArray(user.accountStatus, accountLifecycleMachine.sourcesOf('deleted')),
      ),
    )
    .returning({ id: user.id });
  return moved.length === 1;
}

export async function anonymizeAccount(tx: DbTransaction, userId: string, cutoff: Date) {
  const moved = await tx
    .update(user)
    .set({
      accountStatus: 'anonymized',
      deletedEmail: null,
      name: 'Deleted account',
      image: null,
      timezone: null,
      browserTimezone: null,
      timeFormat: null,
    })
    .where(
      and(
        eq(user.id, userId),
        lt(user.deletedAt, cutoff),
        inArray(user.accountStatus, accountLifecycleMachine.sourcesOf('anonymized')),
      ),
    )
    .returning({ id: user.id });
  return moved.length === 1;
}

export async function purgeAccount(tx: DbTransaction, userId: string, cutoff: Date) {
  const moved = await tx
    .delete(user)
    .where(
      and(
        eq(user.id, userId),
        lt(user.deletedAt, cutoff),
        inArray(user.accountStatus, ['anonymized']),
      ),
    )
    .returning({ id: user.id });
  return moved.length === 1;
}
