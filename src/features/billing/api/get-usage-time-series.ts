import { and, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session, usageEvent } from '@/db/schema';
import 'server-only';

export type UsageTimePoint = { day: string; used: number };

const DAY = sql<string>`to_char(date_trunc('day', ${usageEvent.createdAt}), 'YYYY-MM-DD')`;
const USED = sql<number>`coalesce(sum(-${usageEvent.creditsDelta}), 0)::int`;

// UTC buckets must match the chart labels. Workspace totals include sessionless usage; member filters do not.
export async function getUsageTimeSeries(params: {
  workspaceId: string;
  from: Date;
  to: Date;
  userId: string | null;
}): Promise<UsageTimePoint[]> {
  const window = [
    eq(usageEvent.workspaceId, params.workspaceId),
    lt(usageEvent.creditsDelta, 0),
    gte(usageEvent.createdAt, params.from),
    lte(usageEvent.createdAt, params.to),
  ];

  if (params.userId) {
    return db
      .select({ day: DAY, used: USED })
      .from(usageEvent)
      .innerJoin(session, eq(session.id, usageEvent.sessionId))
      .where(and(...window, eq(session.createdByUserId, params.userId)))
      .groupBy(DAY)
      .orderBy(DAY);
  }

  return db
    .select({ day: DAY, used: USED })
    .from(usageEvent)
    .where(and(...window))
    .groupBy(DAY)
    .orderBy(DAY);
}
