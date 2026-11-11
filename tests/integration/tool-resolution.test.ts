// Tool inputs on real Postgres: a tool resolves only links, schedules and chats the caller may use.

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { resolveToolFile } from '@/features/tools/api/file-resolver';
import { deleteScheduleTool, listSchedulesTool } from '@/features/tools/custom-tools/schedules';
import { withRequestContext } from '@/lib/request-context';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const database = makeTestDb(pool);
const workspaceId = randomUUID();
const context = {
  workspaceId,
  userId: 'owner',
  sessionId: 'upstream-session',
  sessionRowId: randomUUID(),
};
beforeAll(async () => applyMigrations(database));
afterAll(async () => pool.end());
beforeEach(async () => {
  await truncateAll(database);
  await seedUser(database, 'owner');
  await seedUser(database, 'other');
  await seedOrganization(database, 'tool-tests');
  await database.execute(
    sql`insert into workspace (id, organization_id, name) values (${workspaceId}, 'tool-tests', 'Tools')`,
  );
});

test('a plain-HTTP file link is refused, an HTTPS link is used as given', async () => {
  await expect(
    resolveToolFile({ url: 'https://example.test/report.txt' }, context),
  ).resolves.toMatchObject({ foundIn: 'url', filename: 'report.txt' });
  await expect(
    resolveToolFile({ url: 'http://example.test/report.txt' }, context),
  ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
});

test("the schedule tools hide another member's schedule and delete only on the exact title", async () => {
  const taskId = randomUUID();
  await database.execute(sql`insert into task (id, workspace_id, created_by_user_id, title, trigger_type, cron_schedule, timezone, next_run_at)
    values (${taskId}, ${workspaceId}, 'owner', 'Pipeline review', 'schedule', '0 9 * * 1', 'Europe/Vilnius', now() + interval '7 days')`);
  await withRequestContext({ route: 'test/tool-schedules' }, async () => {
    const owned = await listSchedulesTool.handler({}, context);
    expect(owned.schedules.map((schedule) => schedule.schedule_id)).toContain(taskId);
    const hidden = await listSchedulesTool.handler({}, { ...context, userId: 'other' });
    expect(hidden.schedules).toEqual([]);
    await expect(
      deleteScheduleTool.handler({ schedule_id: taskId, title: 'Wrong title' }, context),
    ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
    await expect(
      deleteScheduleTool.handler(
        { schedule_id: taskId, title: 'Pipeline review' },
        { ...context, userId: 'other' },
      ),
    ).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
  });
});

test("conversation search never returns another workspace's, another member's or the current chat", async () => {
  const { searchConversationsTool } = await import(
    '@/features/tools/custom-tools/search-conversations'
  );
  const foreignWorkspaceId = randomUUID();
  await seedOrganization(database, 'foreign-search');
  await database.execute(
    sql`insert into workspace (id, organization_id, name) values (${foreignWorkspaceId}, 'foreign-search', 'Foreign')`,
  );
  const visibleId = randomUUID();
  for (const row of [
    { id: visibleId, workspaceId, userId: 'owner', upstream: 'old-session' },
    { id: randomUUID(), workspaceId, userId: 'other', upstream: 'private-session' },
    { id: randomUUID(), workspaceId, userId: 'owner', upstream: context.sessionId },
    {
      id: randomUUID(),
      workspaceId: foreignWorkspaceId,
      userId: 'owner',
      upstream: 'foreign-session',
    },
  ]) {
    await database.execute(sql`insert into session (workspace_memory_access, id, workspace_id, created_by_user_id, kind, tier, anthropic_session_id, title, search_text)
      values ('read_write', ${row.id}, ${row.workspaceId}, ${row.userId}, 'chat', 'default', ${row.upstream}, 'Client report', 'Review client messages')`);
  }
  const result = await searchConversationsTool.handler({ query: 'client', limit: 10 }, context);
  expect(result.conversations.map((conversation) => conversation.task_id)).toEqual([visibleId]);
});
