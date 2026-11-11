import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { usageEvent } from '@/db/schema';
import 'server-only';

// Without a subscription reset, the workspace's current billing cycle covers its lifetime.
export async function getCycleCreditsUsed(
  workspaceId: string,
  cycleStartedAt: Date | null,
): Promise<number> {
  const row = (
    await db
      .select({ used: sql<number>`coalesce(sum(-${usageEvent.creditsDelta}), 0)::int` })
      .from(usageEvent)
      .where(
        and(
          eq(usageEvent.workspaceId, workspaceId),
          lt(usageEvent.creditsDelta, 0),
          ...(cycleStartedAt ? [gte(usageEvent.createdAt, cycleStartedAt)] : []),
        ),
      )
  ).at(0);
  return row?.used ?? 0;
}
