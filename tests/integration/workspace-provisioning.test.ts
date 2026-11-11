// Provisioning a workspace and each member's own identity on real Postgres: concurrent first
// logins, partial repairs and failed inserts never leave duplicate or orphan rows.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import {
  isOrgFullyProvisioned,
  provisionWorkspaceForOrg,
  readProvisionState,
} from '@/features/workspaces/api/provision';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

vi.mock('@/features/agents', () => ({
  getAnthropicClient: () => null,
  requireAnthropicClient: () => {
    throw new Error('Anthropic is unavailable');
  },
}));

const pool = makeTestPool();
const db = makeTestDb(pool);
beforeAll(() => applyMigrations(db));
beforeEach(() => truncateAll(db));
afterAll(() => pool.end());

const USER = 'user_alice';
const ORG = 'org_alice';
const INVITEE = 'user_invitee';

async function seedOwner() {
  await seedUser(db, USER);
  await seedOrganization(db, ORG);
  await db.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values ('provision-owner', ${ORG}, ${USER}, 'owner', now())`,
  );
}

async function count(query: ReturnType<typeof sql>) {
  return requiredRow((await db.execute<{ count: number }>(query)).rows.at(0)).count;
}

async function identityOf(userId: string) {
  const { rows } = await db.execute<{ composio_user_id: string; provisioning_status: string }>(
    sql`select composio_user_id, provisioning_status from workspace_member where organization_id = ${ORG} and user_id = ${userId}`,
  );
  return rows;
}

test('two concurrent first logins create exactly one workspace and one member row', async () => {
  await seedOwner();
  await Promise.all([
    provisionWorkspaceForOrg({ organizationId: ORG, ownerUserId: USER, name: 'Alice' }),
    provisionWorkspaceForOrg({ organizationId: ORG, ownerUserId: USER, name: 'Alice' }),
  ]);
  expect(
    await count(sql`select count(*)::int as count from workspace where organization_id = ${ORG}`),
  ).toBe(1);
  expect(
    await count(
      sql`select count(*)::int as count from workspace_member where organization_id = ${ORG}`,
    ),
  ).toBe(1);
});

test('a workspace that lost its member row is repaired without a second workspace', async () => {
  await seedOwner();
  await provisionWorkspaceForOrg({ organizationId: ORG, ownerUserId: USER, name: 'Alice' });
  await db.execute(sql`delete from workspace_member where organization_id = ${ORG}`);
  expect(await isOrgFullyProvisioned({ organizationId: ORG, ownerUserId: USER })).toBe(false);

  await provisionWorkspaceForOrg({ organizationId: ORG, ownerUserId: USER, name: 'Alice' });

  expect(
    await count(sql`select count(*)::int as count from workspace where organization_id = ${ORG}`),
  ).toBe(1);
  expect(await identityOf(USER)).toHaveLength(1);
});

test('a failed member insert rolls the new workspace back, leaving no orphan', async () => {
  await seedOrganization(db, ORG);
  await expect(
    provisionWorkspaceForOrg({ organizationId: ORG, ownerUserId: 'ghost_user', name: 'Alice' }),
  ).rejects.toThrow();
  expect(
    await count(sql`select count(*)::int as count from workspace where organization_id = ${ORG}`),
  ).toBe(0);
});

test('an accepted invitee gets their own identity, even on a retry, and the owner keeps theirs', async () => {
  await seedOwner();
  await seedUser(db, INVITEE);
  await db.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values ('invitee-membership', ${ORG}, ${INVITEE}, 'member', now())`,
  );
  await provisionWorkspaceForOrg({ organizationId: ORG, ownerUserId: USER, name: 'Shared' });
  const [owner] = await identityOf(USER);

  await provisionWorkspaceForOrg({ organizationId: ORG, ownerUserId: INVITEE, name: 'Shared' });
  const [first] = await identityOf(INVITEE);
  await provisionWorkspaceForOrg({ organizationId: ORG, ownerUserId: INVITEE, name: 'Shared' });

  expect(
    await count(sql`select count(*)::int as count from workspace where organization_id = ${ORG}`),
  ).toBe(1);
  const invitee = await identityOf(INVITEE);
  expect(invitee).toHaveLength(1);
  expect(invitee[0]).toMatchObject({ provisioning_status: 'ready' });
  expect(invitee[0]?.composio_user_id).toBe(first?.composio_user_id);
  expect(invitee[0]?.composio_user_id).not.toBe(owner?.composio_user_id);
  expect(await identityOf(USER)).toEqual([owner]);
});

test('a person with no membership cannot be provisioned into a workspace', async () => {
  await seedUser(db, INVITEE);
  await expect(
    provisionWorkspaceForOrg({ organizationId: 'org_ghost', ownerUserId: INVITEE, name: 'X' }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const state = await readProvisionState({ organizationId: 'org_ghost', ownerUserId: INVITEE });
  expect(state.memberExists).toBe(false);
});
