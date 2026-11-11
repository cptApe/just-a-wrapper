/** Searching past chats and schedules: matches, privacy and the stored search text, on real Postgres. */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { queryConversationMatches } from '@/features/search/api/query-conversation-matches';
import { queryTaskMatches } from '@/features/search/api/query-task-matches';
import { reconcileSessionSearchText } from '@/features/sessions/api/session-search-text';
import { appendSessionSearchText } from '@/features/sessions/lib/session-search-text';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const db = makeTestDb(pool);

beforeAll(async () => {
  await applyMigrations(db);
});

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function seedWorkspace(): Promise<string> {
  await seedUser(db, 'viewer');
  await seedUser(db, 'other');
  await seedOrganization(db, 'conversation_search_org');
  const { rows } = await db.execute<{ id: string }>(sql`
    insert into workspace (organization_id, name)
    values ('conversation_search_org', 'Conversation search')
    returning id
  `);
  const row = rows.at(0);
  if (!row) throw new Error('Fixture insert returned no row');
  return row.id;
}

async function seedSession(input: {
  workspaceId: string;
  creatorId: string;
  anthropicSessionId: string;
  visibility: 'private' | 'workspace';
  title: string;
  searchText: string | null;
  lastEventAt: string;
}): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(sql`
    insert into session (workspace_memory_access,
      workspace_id, tier, created_by_user_id, kind, anthropic_session_id,
      visibility, title, search_text, last_event_at
    ) values ('read_write',
      ${input.workspaceId}, 'default', ${input.creatorId}, 'chat',
      ${input.anthropicSessionId}, ${input.visibility}, ${input.title},
      ${input.searchText}, ${input.lastEventAt}
    )
    returning id
  `);
  const row = rows.at(0);
  if (!row) throw new Error('Fixture insert returned no row');
  return row.id;
}

function search(input: {
  workspaceId: string;
  query: string;
  currentSessionId?: string;
  limit?: number;
}) {
  return queryConversationMatches({
    workspaceId: input.workspaceId,
    viewerId: 'viewer',
    currentAnthropicSessionId: input.currentSessionId ?? 'current-session',
    contains: `%${input.query}%`,
    limit: input.limit ?? 10,
  });
}

describe('conversation search', () => {
  test("another member's private chat never shows in search or its unsearchable count, even for an empty viewer id", async () => {
    const workspaceId = await seedWorkspace();
    await seedSession({
      workspaceId,
      creatorId: 'other',
      anthropicSessionId: 'hidden-private',
      visibility: 'private',
      title: 'Confidential client',
      searchText: null,
      lastEventAt: '2026-09-03T12:00:00.000Z',
    });
    const visibleId = await seedSession({
      workspaceId,
      creatorId: 'other',
      anthropicSessionId: 'visible-shared',
      visibility: 'workspace',
      title: 'Client plan',
      searchText: null,
      lastEventAt: '2026-09-02T12:00:00.000Z',
    });
    for (const viewerId of ['viewer', '']) {
      const tasks = await queryTaskMatches({
        workspaceId,
        viewerId,
        contains: '%client%',
        prefix: 'client%',
        limit: 10,
      });
      expect(tasks.map((row) => row.id)).toEqual([visibleId]);
      const conversations = await queryConversationMatches({
        workspaceId,
        viewerId,
        currentAnthropicSessionId: 'current',
        contains: '%client%',
        limit: 10,
      });
      expect(conversations.matches.map((row) => row.id)).toEqual([visibleId]);
      expect(conversations.unsearchableCount).toBe(1);
    }
  });
  test('search finds words from inside a chat, newest chat first', async () => {
    const workspaceId = await seedWorkspace();
    const olderId = await seedSession({
      workspaceId,
      creatorId: 'viewer',
      anthropicSessionId: 'older-session',
      visibility: 'private',
      title: 'Garden notes',
      searchText: 'The blue orchid needs indirect light.',
      lastEventAt: '2026-09-01T12:00:00.000Z',
    });
    const newerId = await seedSession({
      workspaceId,
      creatorId: 'viewer',
      anthropicSessionId: 'newer-session',
      visibility: 'private',
      title: 'Plant follow-up',
      searchText: 'I moved the BLUE ORCHID away from the window.',
      lastEventAt: '2026-09-03T12:00:00.000Z',
    });

    const result = await search({ workspaceId, query: 'blue orchid' });

    expect(result.matches.map((row) => row.id)).toEqual([newerId, olderId]);
    expect(result.unsearchableCount).toBe(0);
  });

  test('an older chat with no stored text is still found by its title and counted as unsearchable', async () => {
    const workspaceId = await seedWorkspace();
    const titleOnlyId = await seedSession({
      workspaceId,
      creatorId: 'viewer',
      anthropicSessionId: 'legacy-session',
      visibility: 'private',
      title: 'Quarterly pipeline review',
      searchText: null,
      lastEventAt: '2026-09-02T12:00:00.000Z',
    });

    const result = await search({ workspaceId, query: 'pipeline' });

    expect(result.matches.map((row) => row.id)).toEqual([titleOnlyId]);
    expect(result.matches[0]?.searchText).toBeNull();
    expect(result.unsearchableCount).toBe(1);
  });

  test("search leaves out the chat you are in and another member's private chats", async () => {
    const workspaceId = await seedWorkspace();
    await seedSession({
      workspaceId,
      creatorId: 'viewer',
      anthropicSessionId: 'current-session',
      visibility: 'private',
      title: 'Current phrase',
      searchText: 'shared phrase',
      lastEventAt: '2026-09-03T12:00:00.000Z',
    });
    await seedSession({
      workspaceId,
      creatorId: 'other',
      anthropicSessionId: 'private-session',
      visibility: 'private',
      title: 'Private phrase',
      searchText: 'shared phrase',
      lastEventAt: '2026-09-03T11:00:00.000Z',
    });
    const sharedId = await seedSession({
      workspaceId,
      creatorId: 'other',
      anthropicSessionId: 'shared-session',
      visibility: 'workspace',
      title: 'Shared chat',
      searchText: 'shared phrase',
      lastEventAt: '2026-09-02T12:00:00.000Z',
    });

    const result = await search({ workspaceId, query: 'shared phrase' });

    expect(result.matches.map((row) => row.id)).toEqual([sharedId]);
  });

  test('stored search text keeps the newest 20,000 characters and a replayed turn changes nothing', async () => {
    const workspaceId = await seedWorkspace();
    const sessionId = await seedSession({
      workspaceId,
      creatorId: 'viewer',
      anthropicSessionId: 'append-session',
      visibility: 'private',
      title: 'Append test',
      searchText: `oldest-${'a'.repeat(19_990)}`,
      lastEventAt: '2026-09-03T12:00:00.000Z',
    });

    await reconcileSessionSearchText({
      anthropicSessionId: 'append-session',
      terminalEventIds: ['terminal-event-1'],
      latestTerminalEventId: 'terminal-event-1',
      searchText: appendSessionSearchText(null, [
        `oldest-${'a'.repeat(19_990)}`,
        'What is the newest marker?',
        'The newest marker is cobalt.',
      ]),
    });
    const { rows } = await db.execute<{ search_text: string }>(sql`
      select search_text from session where id = ${sessionId}
    `);

    expect(rows[0]?.search_text).toHaveLength(20_000);
    expect(rows[0]?.search_text).toContain('What is the newest marker?');
    expect(rows[0]?.search_text).toMatch(/The newest marker is cobalt\.$/);
    expect(rows[0]?.search_text).not.toContain('oldest-');

    await reconcileSessionSearchText({
      anthropicSessionId: 'append-session',
      terminalEventIds: ['terminal-event-1'],
      latestTerminalEventId: 'terminal-event-1',
      searchText: appendSessionSearchText(null, [
        `oldest-${'a'.repeat(19_990)}`,
        'What is the newest marker?',
        'The newest marker is cobalt.',
      ]),
    });
    const { rows: repeatedRows } = await db.execute<{ search_text: string }>(sql`
      select search_text from session where id = ${sessionId}
    `);
    expect(repeatedRows[0]?.search_text).toBe(rows[0]?.search_text);
  });

  test('recovery rebuilds search text from full history and an older snapshot never overwrites it', async () => {
    const workspaceId = await seedWorkspace();
    const sessionId = await seedSession({
      workspaceId,
      creatorId: 'viewer',
      anthropicSessionId: 'reconcile-session',
      visibility: 'private',
      title: 'Recovery test',
      searchText: null,
      lastEventAt: '2026-09-03T12:00:00.000Z',
    });

    await reconcileSessionSearchText({
      anthropicSessionId: 'reconcile-session',
      terminalEventIds: ['turn-1', 'turn-2'],
      latestTerminalEventId: 'turn-2',
      searchText: appendSessionSearchText(null, [
        'old question',
        'old answer',
        'latest question',
        `latest-${'z'.repeat(20_000)}`,
      ]),
    });
    const { rows } = await db.execute<{ search_text: string; search_text_event_id: string }>(sql`
      select search_text, search_text_event_id from session where id = ${sessionId}
    `);
    expect(rows[0]?.search_text).toHaveLength(20_000);
    expect(rows[0]?.search_text).not.toContain('old question');
    expect(rows[0]?.search_text).toMatch(/z+$/);
    expect(rows[0]?.search_text_event_id).toBe('turn-2');

    await reconcileSessionSearchText({
      anthropicSessionId: 'reconcile-session',
      terminalEventIds: ['turn-1'],
      latestTerminalEventId: 'turn-1',
      searchText: appendSessionSearchText(null, ['stale question', 'stale answer']),
    });
    const { rows: staleRows } = await db.execute<{
      search_text: string;
      search_text_event_id: string;
    }>(sql`
      select search_text, search_text_event_id from session where id = ${sessionId}
    `);
    expect(staleRows[0]).toEqual(rows[0]);
  });
});

test("schedule search never shows another member's private schedule titles or prompts", async () => {
  const workspaceId = await seedWorkspace();
  await db.execute(sql`insert into task (workspace_id, created_by_user_id, title, description, visibility, trigger_type, cron_schedule)
    values (${workspaceId}, 'other', 'Secret schedule', 'classifiedneedle', 'private', 'schedule', '0 9 * * *'),
           (${workspaceId}, 'other', 'Shared schedule', 'classifiedneedle', 'workspace', 'schedule', '0 9 * * *')`);
  const { searchWorkspace } = await import('@/features/search/api/search');
  const { withRequestContext } = await import('@/lib/request-context');
  const results = await withRequestContext({ route: 'test/scheduled-search' }, () =>
    searchWorkspace({
      workspaceId,
      userId: 'viewer',
      query: 'classifiedneedle',
      headers: new Headers(),
    }),
  );
  expect(results.filter((row) => row.group === 'scheduled').map((row) => row.title)).toEqual([
    'Shared schedule',
  ]);
});
