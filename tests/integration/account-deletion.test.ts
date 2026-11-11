// Deleting an account or a workspace through the public actions, on real auth and Postgres.
// Framework scheduling is held until after the action response, as in production.
const background = vi.hoisted(() => ({ jobs: [] as Array<() => Promise<unknown>> }));
vi.mock('next/server', () => ({
  after: (job: () => Promise<unknown>) => background.jobs.push(job),
}));

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';

// Each queued request reads its own headers; the last one stays for any later read.
const requests = vi.hoisted(() => ({ headers: [] as Headers[] }));
vi.mock('next/headers', () => ({
  headers: async () => {
    const current = requests.headers.length > 1 ? requests.headers.shift() : requests.headers[0];
    if (!current) throw new Error('Missing test request headers');
    return current;
  },
}));

import { deleteWorkspace } from '@/features/workspaces/api/danger-actions';
import { deleteAccountAction } from '@/features/workspaces/api/delete-account';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { signInWithEmailCode } from './helpers/sign-in';
import { makeTestDb, makeTestPool } from './helpers/test-db';
import { createTestWorkspace } from './helpers/workspace-actions';

const pool = makeTestPool();
const db = makeTestDb(pool);
beforeAll(() => applyMigrations(db));
beforeEach(async () => {
  await truncateAll(db);
  requests.headers = [];
  background.jobs = [];
});
afterAll(() => pool.end());

async function signIn(email: string, organizationId: string) {
  const { headers, sessionId } = await signInWithEmailCode(email);
  await db.execute(
    sql`update auth_session set active_organization_id = ${organizationId} where id = ${sessionId}`,
  );
  return headers;
}

async function addWorkspace(organizationId: string, owners: string[], otherMembers: string[]) {
  await seedOrganization(db, organizationId);
  await db.execute(
    sql`insert into workspace (organization_id, name) values (${organizationId}, ${organizationId})`,
  );
  for (const userId of [...owners, ...otherMembers]) {
    const role = owners.includes(userId) ? 'owner' : 'member';
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role, created_at) values (${randomUUID()}, ${organizationId}, ${userId}, ${role}, now())`,
    );
  }
}

test('account deletion deletes the workspaces only that person uses and leaves shared ones live', async () => {
  const email = 'soloist@deletion.test';
  const { headers, userId } = await signInWithEmailCode(email);
  const solo = await createTestWorkspace({ body: { name: 'Solo', slug: 'solo-org' }, headers });
  await seedUser(db, 'co-owner', 'co-owner@deletion.test');
  await addWorkspace('shared', ['co-owner'], [userId]);
  requests.headers = [headers];

  expect((await deleteAccountAction(email)).ok).toBe(true);

  const { rows } = await db.execute<{ organization_id: string; deleted: boolean }>(
    sql`select organization_id, deleted_at is not null as deleted from workspace order by organization_id`,
  );
  expect(rows).toEqual(
    expect.arrayContaining([
      { organization_id: solo.id, deleted: true },
      { organization_id: 'shared', deleted: false },
    ]),
  );
  const person = await db.execute(sql`select deleted_at from "user" where id = ${userId}`);
  expect(person.rows.at(0)?.deleted_at).not.toBeNull();
});

test('two co-owners deleting their accounts at once cannot leave the remaining member without an owner', async () => {
  await seedUser(db, 'owner-a', 'a@deletion.test');
  await seedUser(db, 'owner-b', 'b@deletion.test');
  await seedUser(db, 'remaining', 'remaining@deletion.test');
  await addWorkspace('shared', ['owner-a', 'owner-b'], ['remaining']);
  requests.headers = [
    await signIn('a@deletion.test', 'shared'),
    await signIn('b@deletion.test', 'shared'),
  ];
  const outcomes = await Promise.all([
    deleteAccountAction('a@deletion.test'),
    deleteAccountAction('b@deletion.test'),
  ]);
  expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
  expect(
    outcomes.filter((outcome) => !outcome.ok && outcome.code === 'SOLE_OWNER_BLOCKED'),
  ).toHaveLength(1);
  const { rows } = await db.execute(
    sql`select role from member where organization_id = 'shared' and role = 'owner'`,
  );
  expect(rows).toHaveLength(1);
});

test('deleting the last two workspaces at once keeps one and points both devices at it', async () => {
  await seedUser(db, 'owner', 'owner@deletion.test');
  await addWorkspace('first', ['owner'], []);
  await addWorkspace('second', ['owner'], []);
  requests.headers = [
    await signIn('owner@deletion.test', 'first'),
    await signIn('owner@deletion.test', 'second'),
  ];
  const targets = await db.execute<{ id: string; organization_id: string }>(
    sql`select id, organization_id from workspace`,
  );
  const firstId = targets.rows.find((row) => row.organization_id === 'first')?.id;
  const secondId = targets.rows.find((row) => row.organization_id === 'second')?.id;
  if (!firstId || !secondId) throw new Error('Missing test workspace');
  const outcomes = await Promise.all([
    deleteWorkspace({ confirmName: 'first', workspaceId: firstId }),
    deleteWorkspace({ confirmName: 'second', workspaceId: secondId }),
  ]);
  expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
  expect(outcomes.filter((outcome) => !outcome.ok)).toHaveLength(1);
  const live = await db.execute<{ organization_id: string }>(
    sql`select organization_id from workspace where lifecycle_status = 'live'`,
  );
  expect(live.rows).toHaveLength(1);
  const surviving = live.rows.at(0);
  if (!surviving) throw new Error('No surviving workspace');
  const devices = await db.execute(
    sql`select active_organization_id from auth_session where user_id = 'owner'`,
  );
  expect(devices.rows).toHaveLength(2);
  expect(
    devices.rows.every((device) => device.active_organization_id === surviving.organization_id),
  ).toBe(true);
});

test('account deletion revokes app access left without a membership and keeps its provider cleanup', async () => {
  await seedUser(db, 'orphan', 'orphan@deletion.test');
  await seedUser(db, 'workspace-owner', 'workspace-owner@deletion.test');
  await addWorkspace('shared-orphan', ['workspace-owner'], []);
  await db.execute(
    sql`insert into workspace_member (organization_id, user_id, composio_user_id) values ('shared-orphan', 'orphan', 'orphan-composio')`,
  );
  requests.headers = [await signIn('orphan@deletion.test', 'shared-orphan')];
  expect((await deleteAccountAction('orphan@deletion.test')).ok).toBe(true);
  const access = await db.execute(
    sql`select user_id from workspace_member where user_id = 'orphan'`,
  );
  expect(access.rows).toHaveLength(0);
  const cleanup = await db.execute(
    sql`select composio_user_id from integration_cleanup where composio_user_id = 'orphan-composio'`,
  );
  expect(cleanup.rows).toHaveLength(1);
});

test('repeating a committed workspace deletion cannot delete another workspace renamed to match', async () => {
  await seedUser(db, 'owner', 'owner@deletion.test');
  await addWorkspace('first', ['owner'], []);
  await addWorkspace('second', ['owner'], []);
  const { rows } = await db.execute<{ id: string }>(
    sql`select id from workspace where organization_id = 'first'`,
  );
  const target = rows.at(0);
  if (!target) throw new Error('Missing target');
  await db.execute(
    sql`insert into task (workspace_id, created_by_user_id, title, trigger_type, cron_schedule, timezone, anthropic_deployment_id) values (${target.id}, 'owner', 'Task', 'schedule', '0 9 * * *', 'UTC', 'deployment_failed')`,
  );
  const headers = await signIn('owner@deletion.test', 'first');
  requests.headers = [headers];
  expect(await deleteWorkspace({ confirmName: 'first', workspaceId: target.id })).toEqual({
    ok: true,
    data: 'DELETED',
  });
  await db.execute(sql`update workspace set name = 'first' where organization_id = 'second'`);
  expect(await deleteWorkspace({ confirmName: 'first', workspaceId: target.id })).toMatchObject({
    ok: false,
    code: 'WORKSPACE_CHANGED',
  });
  expect(
    (
      await db.execute(sql`select lifecycle_status from workspace where organization_id = 'second'`)
    ).rows.at(0),
  ).toEqual({ lifecycle_status: 'live' });
});

test('account deletion cleans up only its own provider resources, after it returns', async () => {
  await seedUser(db, 'leaving', 'leaving@deletion.test');
  await seedOrganization(db, 'leaving-org');
  await db.execute(
    sql`insert into workspace_member (organization_id, user_id, composio_user_id) values ('leaving-org', 'leaving', 'leaving-provider')`,
  );
  await db.execute(
    sql`insert into integration_cleanup (composio_user_id) values ('unrelated-provider')`,
  );
  requests.headers = [await signIn('leaving@deletion.test', 'leaving-org')];
  expect(await deleteAccountAction('leaving@deletion.test')).toMatchObject({ ok: true });
  expect(background.jobs).toHaveLength(2);
  expect(
    (await db.execute(sql`select composio_user_id from integration_cleanup`)).rows,
  ).toHaveLength(2);
  for (const job of background.jobs) await job();
  expect((await db.execute(sql`select composio_user_id from integration_cleanup`)).rows).toEqual([
    { composio_user_id: 'unrelated-provider' },
  ]);
});

test('owning an already deleted shared workspace does not block account deletion', async () => {
  await seedUser(db, 'departing-owner', 'departing@deletion.test');
  await seedUser(db, 'remaining-member', 'remaining@deletion.test');
  await addWorkspace('deleted-shared', ['departing-owner'], ['remaining-member']);
  await db.execute(
    sql`update workspace set lifecycle_status = 'deleted', deleted_at = now() where organization_id = 'deleted-shared'`,
  );
  requests.headers = [await signIn('departing@deletion.test', 'deleted-shared')];
  expect(await deleteAccountAction('departing@deletion.test')).toMatchObject({ ok: true });
});
