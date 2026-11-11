/** Sharing a chat with the team or by public link: one live link, revokes stick, failures roll back; real Postgres. */
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { sessionShare } from '@/db/schema';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { seedChatSession } from './helpers/seed-chat-session';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const boundary = vi.hoisted(() => ({ after: [] as Array<() => Promise<void>>, capture: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/server', () => ({
  after: (callback: () => Promise<void>) => boundary.after.push(callback),
}));
vi.mock('@/lib/auth', async () =>
  (await import('./helpers/seams')).signedInAs(() => ({
    userId: 'owner',
    name: 'Owner',
    organizationId: 'org',
  })),
);
vi.mock('@/lib/observability', () => ({ captureException: boundary.capture }));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

const { setSessionShareChoice } = await import('@/features/chat/api/shares');
const { resolveSessionShare } = await import('@/features/chat/api/resolve-share');
const { hideSession } = await import('@/features/sessions/api/update-session');
const { revokeLiveShares } = await import('@/features/sessions/api/share-transitions');

const pool = makeTestPool();
const db = makeTestDb(pool);
beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  boundary.after.length = 0;
  boundary.capture.mockClear();
  await seedUser(db, 'owner');
  await seedOrganization(db, 'org');
  await db.execute(sql`insert into workspace (organization_id, name) values ('org', 'Org')`);
  await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at)
    values ('org-owner', 'org', 'owner', 'owner', now())`);
});

const chat = (extra: Partial<Parameters<typeof seedChatSession>[2]> = {}) =>
  seedChatSession(db, 'org', {
    createdByUserId: 'owner',
    workspaceMemoryAccess: 'read_write',
    ...extra,
  });

async function publicLink(sessionId: string) {
  const response = await setSessionShareChoice(sessionId, 'public');
  assert.ok(response.ok && response.data.share);
  return response.data.share.token;
}

async function shares(sessionId: string, live: boolean) {
  const { rows } = await db.execute(
    live
      ? sql`select revoked_at from session_share where session_id = ${sessionId} and revoked_at is null`
      : sql`select revoked_at from session_share where session_id = ${sessionId} and revoked_at is not null`,
  );
  return rows;
}

async function visibility(sessionId: string) {
  const { rows } = await db.execute<{ visibility: string }>(
    sql`select visibility from session where id = ${sessionId}`,
  );
  return rows[0]?.visibility;
}

async function runAfterJobs() {
  for (const callback of boundary.after.splice(0)) await callback();
}

test('sharing with the team stays committed when its notifications and live updates fail', async () => {
  const row = await chat();
  // Recipient lookup and realtime publication fail against the real database.
  await db.execute(sql`alter table workspace_member rename to unavailable_workspace_member`);
  await db.execute(sql`alter table realtime_event rename to unavailable_realtime_event`);
  try {
    expect(await setSessionShareChoice(row.id, 'team')).toMatchObject({ ok: true });
    expect(await visibility(row.id)).toBe('workspace');
    await runAfterJobs();
    expect(boundary.capture).toHaveBeenCalled();
    // A repeat of the same choice changes nothing and schedules nothing.
    expect(await setSessionShareChoice(row.id, 'team')).toMatchObject({ ok: true });
    expect(boundary.after).toHaveLength(0);
    expect(await setSessionShareChoice(row.id, 'private')).toMatchObject({ ok: true });
    expect(await visibility(row.id)).toBe('private');
    await runAfterJobs();
  } finally {
    await db.execute(sql`alter table unavailable_workspace_member rename to workspace_member`);
    await db.execute(sql`alter table unavailable_realtime_event rename to realtime_event`);
  }
});

test('two public link requests at once give one live link, and a revoked link stays revoked', async () => {
  const row = await chat();
  const tokens = await Promise.all([publicLink(row.id), publicLink(row.id)]);
  expect(new Set(tokens).size).toBe(1);
  expect(await shares(row.id, true)).toHaveLength(1);
  expect((await setSessionShareChoice(row.id, 'private')).ok).toBe(true);
  const revoked = await shares(row.id, false);
  expect((await setSessionShareChoice(row.id, 'private')).ok).toBe(true);
  expect(await shares(row.id, false)).toEqual(revoked);
  await publicLink(row.id);
  expect(await shares(row.id, false)).toEqual(revoked);
});

test('a failed switch from public to team keeps the public link live', async () => {
  const row = await chat();
  await publicLink(row.id);
  await db.execute(
    sql`alter table session add constraint test_deny_team check (visibility = 'private')`,
  );
  try {
    expect((await setSessionShareChoice(row.id, 'team')).ok).toBe(false);
    expect(await shares(row.id, true)).toHaveLength(1);
  } finally {
    await db.execute(sql`alter table session drop constraint test_deny_team`);
  }
  expect((await setSessionShareChoice(row.id, 'team')).ok).toBe(true);
  expect(await shares(row.id, true)).toHaveLength(0);
});

test('a deleted chat cannot be shared by a stale page', async () => {
  const row = await chat({ status: 'terminated', hiddenAt: new Date() });
  expect((await setSessionShareChoice(row.id, 'team')).ok).toBe(false);
  expect(await visibility(row.id)).toBe('private');
});

test('an expired link is replaced by a new token and its revocation is never rewritten', async () => {
  const row = await chat();
  const first = await publicLink(row.id);
  await db.execute(
    sql`update session_share set expires_at = now() - interval '1 second' where session_id = ${row.id}`,
  );
  expect(await publicLink(row.id)).not.toBe(first);
  const retired = await db.execute(
    sql`select revoked_at from session_share where token = ${first}`,
  );
  expect(retired.rows.at(0)?.revoked_at).toBeTruthy();
  await publicLink(row.id);
  expect(
    (await db.execute(sql`select revoked_at from session_share where token = ${first}`)).rows,
  ).toEqual(retired.rows);
});

test.each([
  'deleting',
  'deleted',
] as const)('a public link stops resolving once its workspace is %s', async (lifecycle) => {
  const row = await chat();
  const token = await publicLink(row.id);
  await db.execute(
    sql`update workspace set lifecycle_status = ${lifecycle}, deleted_at = now() where id = ${row.workspaceId}`,
  );
  expect(await resolveSessionShare(token)).toEqual({ status: 'revoked' });
});

test('deleting a chat revokes its public link', async () => {
  const row = await chat();
  await publicLink(row.id);
  await hideSession({ sessionId: row.id, workspaceId: row.workspaceId });
  expect(await shares(row.id, true)).toHaveLength(0);
  expect(
    await revokeLiveShares(db, eq(sessionShare.sessionId, row.id), { expiredOnly: false }),
  ).toEqual([]);
});
