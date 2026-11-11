import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { member, session, usageEvent, user } from '@/db/schema';
import 'server-only';

export type UsageByMemberRow = { userId: string; name: string; email: string; used: number };

const USED = sql<number>`coalesce(sum(-${usageEvent.creditsDelta}), 0)::int`;

// The loader exposes member breakdowns only to admins; rows without a session do not belong to a member.
export async function getUsageByMember(params: {
  workspaceId: string;
  from: Date;
  to: Date;
}): Promise<UsageByMemberRow[]> {
  return db
    .select({
      userId: session.createdByUserId,
      name: user.name,
      email: user.email,
      used: USED,
    })
    .from(usageEvent)
    .innerJoin(session, eq(session.id, usageEvent.sessionId))
    .innerJoin(user, eq(user.id, session.createdByUserId))
    .where(
      and(
        eq(usageEvent.workspaceId, params.workspaceId),
        lt(usageEvent.creditsDelta, 0),
        gte(usageEvent.createdAt, params.from),
        lte(usageEvent.createdAt, params.to),
      ),
    )
    .groupBy(session.createdByUserId, user.name, user.email)
    .orderBy(desc(USED));
}

// Scope identity through organization membership so a foreign user ID cannot disclose a name or email.
export async function getUsageMemberIdentity(
  organizationId: string,
  userId: string,
): Promise<{ name: string; email: string } | null> {
  const row = (
    await db
      .select({ name: user.name, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      .limit(1)
  ).at(0);
  return row ?? null;
}
