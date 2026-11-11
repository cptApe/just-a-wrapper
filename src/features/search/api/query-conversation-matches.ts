import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { session } from '@/db/schema';
import { sessionVisibleToViewer } from '@/features/sessions/api/session-visibility';

export type ConversationSearchMatch = {
  id: string;
  title: string | null;
  searchText: string | null;
  lastActiveAt: Date;
};

// Apply session privacy before both matching and counting; even corpus counts must not reveal private chats.
export async function queryConversationMatches(input: {
  workspaceId: string;
  viewerId: string;
  currentAnthropicSessionId: string;
  contains: string;
  limit: number;
}): Promise<{ matches: ConversationSearchMatch[]; unsearchableCount: number }> {
  const visibility = sessionVisibleToViewer(input.viewerId);
  const matchesQuery = await db.execute<{
    id: string | null;
    title: string | null;
    searchText: string | null;
    // Raw execute skips column decoding, so the driver's timestamp text arrives here.
    lastActiveAt: string | null;
    unsearchableCount: number;
  }>(sql`
    with visible as (
      select
        ${session.id} as id,
        ${session.title} as title,
        ${session.searchText} as search_text,
        coalesce(${session.lastEventAt}, ${session.createdAt}) as last_active_at
      from ${session}
      where ${session.workspaceId} = ${input.workspaceId}
        and ${session.kind} = 'chat'
        and ${session.anthropicSessionId} is not null
        and ${session.anthropicSessionId} <> ${input.currentAnthropicSessionId}
        and ${session.hiddenAt} is null
        and ${visibility}
    ), matching as (
      select *
      from visible
      where title ilike ${input.contains}
        or search_text ilike ${input.contains}
      order by last_active_at desc
      limit ${input.limit}
    ), summary as (
      select count(*) filter (where search_text is null)::int as unsearchable_count
      from visible
    )
    select
      matching.id,
      matching.title,
      matching.search_text as "searchText",
      matching.last_active_at as "lastActiveAt",
      summary.unsearchable_count as "unsearchableCount"
    from summary
    left join matching on true
    order by matching.last_active_at desc nulls last
  `);

  const unsearchableCount = Number(matchesQuery.rows[0]?.unsearchableCount ?? 0);
  const matches = matchesQuery.rows.flatMap((row) =>
    row.id && row.lastActiveAt
      ? [
          {
            id: row.id,
            title: row.title,
            searchText: row.searchText,
            lastActiveAt: new Date(row.lastActiveAt),
          },
        ]
      : [],
  );
  return { matches, unsearchableCount };
}
