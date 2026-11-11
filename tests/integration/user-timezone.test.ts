/**
 * Browser timezone persistence and agent context integration tests.
 *
 * The tests use the real Better Auth server and Postgres schema. Only Next's
 * request headers are mocked so the route receives the signed-in user's cookie.
 */
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { auth } from '@/lib/auth';
import { withRequestContext } from '@/lib/request-context';
import { applyMigrations, truncateAll } from './helpers/schema-setup';
import { signInWithEmailCode } from './helpers/sign-in';
import { makeTestDb, makeTestPool } from './helpers/test-db';
import { createTestWorkspace } from './helpers/workspace-actions';

const routeState = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => routeState.headers }));

const { PATCH } = await import('@/app/api/preferences/timezone/route');
const { getUserContextTool } = await import('@/features/tools/custom-tools/get-user-context');

const pool = makeTestPool();
const db = makeTestDb(pool);

beforeAll(async () => {
  await applyMigrations(db);
});

beforeEach(async () => {
  await truncateAll(db);
  routeState.headers = new Headers();
});

afterAll(async () => {
  await pool.end();
});

async function setupUser(email: string): Promise<{ userId: string; workspaceId: string }> {
  routeState.headers = (await signInWithEmailCode(email)).headers;
  const organization = await createTestWorkspace({
    body: { name: 'Timezone Test', slug: `timezone-${crypto.randomUUID()}` },
    headers: routeState.headers,
  });
  if (!organization) throw new Error('createOrganization returned null');
  await auth.api.setActiveOrganization({
    body: { organizationId: organization.id },
    headers: routeState.headers,
  });

  const [row] = (
    await db.execute<{ user_id: string; workspace_id: string }>(sql`
      select m.user_id, w.id as workspace_id
      from member m
      inner join workspace w on w.organization_id = m.organization_id
      where m.organization_id = ${organization.id}
      limit 1
    `)
  ).rows;
  assert.ok(row, 'Signed-in user requires a provisioned workspace');
  return { userId: row.user_id, workspaceId: row.workspace_id };
}

test('reporting the browser timezone never overwrites the timezone the person chose', async () => {
  const email = 'browser-timezone@test.local';
  const { userId } = await setupUser(email);
  await db.execute(sql`update "user" set timezone = 'Asia/Tokyo' where id = ${userId}`);

  const response = await PATCH(
    new Request('http://test/api/preferences/timezone', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone: 'Europe/Vilnius' }),
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ timezone: 'Europe/Vilnius' });
  const [stored] = (
    await db.execute<{ timezone: string | null; browser_timezone: string | null }>(
      sql`select timezone, browser_timezone from "user" where email = ${email}`,
    )
  ).rows;
  expect(stored).toEqual({ timezone: 'Asia/Tokyo', browser_timezone: 'Europe/Vilnius' });
});

test('the agent sees the browser timezone when the person left their timezone on Auto', async () => {
  const { userId, workspaceId } = await setupUser('agent-timezone@test.local');
  await db.execute(
    sql`update "user" set timezone = null, browser_timezone = 'Europe/Vilnius' where id = ${userId}`,
  );

  const result = await withRequestContext({ route: 'test-get-user-context-timezone' }, () =>
    getUserContextTool.handler(
      {},
      {
        workspaceId,
        userId,
        sessionId: 'anthropic-session',
        sessionRowId: crypto.randomUUID(),
      },
    ),
  );

  expect(result.user.timezone).toBe('Europe/Vilnius');
});
