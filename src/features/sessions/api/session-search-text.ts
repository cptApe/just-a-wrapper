import 'server-only';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';
import { SESSION_SEARCH_TEXT_MAX_CHARS } from '../lib/session-search-text';

// Only replace search text when its marker is absent or in the observed history. A reconnect must
// not overwrite a newer completed turn from another relay.
export async function reconcileSessionSearchText(input: {
  anthropicSessionId: string;
  terminalEventIds: readonly string[];
  latestTerminalEventId: string;
  searchText: string;
}): Promise<void> {
  if (input.terminalEventIds.length === 0) return;
  await db
    .update(sessionTable)
    .set({
      searchText: input.searchText.slice(-SESSION_SEARCH_TEXT_MAX_CHARS),
      searchTextEventId: input.latestTerminalEventId,
    })
    .where(
      and(
        eq(sessionTable.anthropicSessionId, input.anthropicSessionId),
        sql`${sessionTable.searchTextEventId} is distinct from ${input.latestTerminalEventId}`,
        or(
          isNull(sessionTable.searchTextEventId),
          inArray(sessionTable.searchTextEventId, input.terminalEventIds),
        ),
      ),
    );
}
