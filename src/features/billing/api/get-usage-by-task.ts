import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session, usageEvent } from '@/db/schema';
import 'server-only';

export type UsageByTaskRow = {
  sessionId: string;
  title: string | null;
  createdByUserId: string;
  used: number;
};

const USED = sql<number>`coalesce(sum(-${usageEvent.creditsDelta}), 0)::int`;

// Rows without a session do not belong to a task and are excluded from this breakdown.
export async function getUsageByTask(params: {
  workspaceId: string;
  from: Date;
  to: Date;
  userId: string | null;
}): Promise<UsageByTaskRow[]> {
  const window = [
    eq(usageEvent.workspaceId, params.workspaceId),
    lt(usageEvent.creditsDelta, 0),
    gte(usageEvent.createdAt, params.from),
    lte(usageEvent.createdAt, params.to),
    ...(params.userId ? [eq(session.createdByUserId, params.userId)] : []),
  ];

  return db
    .select({
      sessionId: session.id,
      title: session.title,
      createdByUserId: session.createdByUserId,
      used: USED,
    })
    .from(usageEvent)
    .innerJoin(session, eq(session.id, usageEvent.sessionId))
    .where(and(...window))
    .groupBy(session.id, session.title, session.createdByUserId)
    .orderBy(desc(USED));
}
