import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session, usageEvent } from '@/db/schema';
import 'server-only';

export type UsageByTypeRow = {
  eventType: string;
  credits: number;
  events: number;
};

const CREDITS = sql<number>`coalesce(sum(-${usageEvent.creditsDelta}), 0)::int`;
const EVENTS = sql<number>`count(*)::int`;

// Workspace totals include sessionless consumption; a member filter attributes only that member's sessions.
export async function getUsageByType(params: {
  workspaceId: string;
  from: Date;
  to: Date;
  userId: string | null;
}): Promise<UsageByTypeRow[]> {
  const window = [
    eq(usageEvent.workspaceId, params.workspaceId),
    lt(usageEvent.creditsDelta, 0),
    gte(usageEvent.createdAt, params.from),
    lte(usageEvent.createdAt, params.to),
  ];

  if (params.userId) {
    return db
      .select({ eventType: usageEvent.eventType, credits: CREDITS, events: EVENTS })
      .from(usageEvent)
      .innerJoin(session, eq(session.id, usageEvent.sessionId))
      .where(and(...window, eq(session.createdByUserId, params.userId)))
      .groupBy(usageEvent.eventType)
      .orderBy(desc(CREDITS));
  }

  return db
    .select({ eventType: usageEvent.eventType, credits: CREDITS, events: EVENTS })
    .from(usageEvent)
    .where(and(...window))
    .groupBy(usageEvent.eventType)
    .orderBy(desc(CREDITS));
}
