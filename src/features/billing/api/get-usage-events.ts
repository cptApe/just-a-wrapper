import { and, desc, eq, gte, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session, usageEvent, user } from '@/db/schema';
import 'server-only';

export type UsageEventRow = {
  id: string;
  at: Date;
  eventType: string;
  credits: number;
  platformPaid: boolean;
  sessionId: string | null;
  sessionTitle: string | null;
  memberName: string | null;
  memberEmail: string | null;
};

const CREDITS = sql<number>`(-${usageEvent.creditsDelta})::int`;

// Keep sessionless rows in workspace logs; member filters only include attributable sessions.
// The explicit limit supports pagination, and the ID tie-breaker keeps equal timestamps stable.
export async function getUsageEvents(params: {
  workspaceId: string;
  from: Date;
  to: Date;
  userId: string | null;
  limit: number;
}): Promise<UsageEventRow[]> {
  const window = [
    eq(usageEvent.workspaceId, params.workspaceId),
    or(lt(usageEvent.creditsDelta, 0), eq(usageEvent.platformPaid, true)),
    gte(usageEvent.createdAt, params.from),
    lte(usageEvent.createdAt, params.to),
  ];

  const columns = {
    id: usageEvent.id,
    at: usageEvent.createdAt,
    eventType: usageEvent.eventType,
    credits: CREDITS,
    platformPaid: usageEvent.platformPaid,
    sessionId: usageEvent.sessionId,
    sessionTitle: session.title,
    memberName: user.name,
    memberEmail: user.email,
  };

  if (params.userId) {
    return db
      .select(columns)
      .from(usageEvent)
      .innerJoin(session, eq(session.id, usageEvent.sessionId))
      .leftJoin(user, eq(user.id, session.createdByUserId))
      .where(and(...window, eq(session.createdByUserId, params.userId)))
      .orderBy(desc(usageEvent.createdAt), desc(usageEvent.id))
      .limit(params.limit);
  }

  return db
    .select(columns)
    .from(usageEvent)
    .leftJoin(session, eq(session.id, usageEvent.sessionId))
    .leftJoin(user, eq(user.id, session.createdByUserId))
    .where(and(...window))
    .orderBy(desc(usageEvent.createdAt), desc(usageEvent.id))
    .limit(params.limit);
}
