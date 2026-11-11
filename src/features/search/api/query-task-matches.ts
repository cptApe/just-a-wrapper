import 'server-only';
import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session } from '@/db/schema';
import { sessionVisibleToViewer } from '@/features/sessions/api/session-access';

/** Task title and persisted message-text matches for the deferred server response. */
export async function queryTaskMatches(input: {
  workspaceId: string;
  contains: string;
  prefix: string;
  limit: number;
  viewerId: string;
}) {
  return db
    .select({
      id: session.id,
      title: session.title,
      titleMatches: sql<boolean>`${session.title} ilike ${input.contains}`,
      status: session.status,
      lastEventAt: session.lastEventAt,
      createdAt: session.createdAt,
    })
    .from(session)
    .where(
      and(
        eq(session.workspaceId, input.workspaceId),
        eq(session.kind, 'chat'),
        isNotNull(session.anthropicSessionId),
        isNull(session.hiddenAt),
        or(ilike(session.title, input.contains), ilike(session.searchText, input.contains)),
        sessionVisibleToViewer(input.viewerId),
      ),
    )
    .orderBy(
      sql`case when ${session.title} ilike ${input.prefix} then 0 else 1 end`,
      sql`case when ${session.title} ilike ${input.contains} then 0 else 1 end`,
      sql`${session.lastEventAt} desc nulls last`,
      desc(session.createdAt),
    )
    .limit(input.limit);
}
