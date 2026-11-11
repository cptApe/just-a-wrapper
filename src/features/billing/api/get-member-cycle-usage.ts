import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session, usageEvent, workspace } from '@/db/schema';
import 'server-only';
import { memberCreditPeriodStart } from '../lib/credit-grants';
import { readDatabaseClock } from './ledger-lock';

// Return a sparse map instead of one query per member; zero-spend members are absent.
// The period is decided on the database clock, the same clock the spend gate uses.
export async function getMemberCycleUsage(organizationId: string): Promise<Record<string, number>> {
  return db.transaction(async (tx) => {
    const workspaceRow = (
      await tx
        .select({
          id: workspace.id,
          creditResetAt: workspace.creditResetAt,
          planTier: workspace.planTier,
        })
        .from(workspace)
        .where(eq(workspace.organizationId, organizationId))
        .limit(1)
    ).at(0);
    if (!workspaceRow) return {};

    const periodStart = memberCreditPeriodStart({
      planTier: workspaceRow.planTier,
      creditResetAt: workspaceRow.creditResetAt,
      now: await readDatabaseClock(tx),
    });
    const rows = await tx
      .select({
        userId: sql<string>`coalesce(${usageEvent.userId}, ${session.createdByUserId})`,
        used: sql<number>`coalesce(sum(-${usageEvent.creditsDelta}), 0)::int`,
      })
      .from(usageEvent)
      .leftJoin(session, eq(session.id, usageEvent.sessionId))
      .where(
        and(
          eq(usageEvent.workspaceId, workspaceRow.id),
          lt(usageEvent.creditsDelta, 0),
          gte(usageEvent.createdAt, periodStart),
        ),
      )
      .groupBy(sql`coalesce(${usageEvent.userId}, ${session.createdByUserId})`);

    const byUser: Record<string, number> = {};
    for (const row of rows) byUser[row.userId] = row.used;
    return byUser;
  });
}
