// The workspace, account, invitation and membership state machines on real Postgres: stale and terminal
// writes are refused and membership removal revokes access across tables at once.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { db } from '@/db';
import {
  auth_session,
  integration,
  integrationCleanup,
  invitation,
  member,
  user,
  workspace,
  workspaceMember,
} from '@/db/schema';
import {
  anonymizeAccount,
  purgeAccount,
  tombstoneAccount,
} from '@/features/auth/api/account-lifecycle-transitions';
import {
  assignActiveOrganization,
  evacuateOrganizationSessions,
} from '@/features/workspaces/api/active-organization-transitions';
import {
  acceptInvitationMember,
  moveInvitation,
} from '@/features/workspaces/api/invitation-transitions';
import { moveMemberRole } from '@/features/workspaces/api/member-role-transitions';
import { removeMembership } from '@/features/workspaces/api/membership-transitions';
import {
  claimWorkspaceDeletion,
  claimWorkspacePurge,
  finishWorkspaceDeletion,
  finishWorkspacePurge,
} from '@/features/workspaces/api/workspace-lifecycle-transitions';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const database = makeTestDb(pool);
const actor = 'lifecycle-user';
const organizationId = 'lifecycle-org';
const otherOrganizationId = 'lifecycle-other';
const old = new Date(Date.now() - 40 * 86_400_000);
const cutoff = new Date(Date.now() - 30 * 86_400_000);
let workspaceId: string;
beforeAll(() => applyMigrations(database));
beforeEach(async () => {
  await truncateAll(database);
  await seedUser(database, actor);
  await seedOrganization(database, organizationId);
  await seedOrganization(database, otherOrganizationId);
  const created = (
    await database.insert(workspace).values({ organizationId, name: 'Lifecycle' }).returning()
  ).at(0);
  if (created === undefined) throw new Error('Missing workspace fixture');
  workspaceId = created.id;
  await database.insert(workspace).values({ organizationId: otherOrganizationId, name: 'Other' });
  await database.insert(member).values([
    { id: 'lifecycle-member', organizationId, userId: actor, role: 'owner', createdAt: new Date() },
    {
      id: 'lifecycle-other-member',
      organizationId: otherOrganizationId,
      userId: actor,
      role: 'owner',
      createdAt: new Date(),
    },
  ]);
  await database.insert(workspaceMember).values({
    organizationId,
    userId: actor,
    composioUserId: 'lifecycle-composio',
    mcpProxyVaultId: 'lifecycle-vault',
    userMemoryStoreId: 'lifecycle-memory',
  });
});
afterAll(() => pool.end());

async function addSession(id: string, activeOrganizationId: string | null) {
  await database.insert(auth_session).values({
    id,
    token: `token-${id}`,
    userId: actor,
    activeOrganizationId,
    expiresAt: new Date(Date.now() + 86_400_000),
    updatedAt: new Date(),
  });
}

async function addInvitation(id: string, expiresAt: Date) {
  await database.insert(invitation).values({
    id,
    organizationId,
    inviterId: actor,
    email: `${actor}@example.test`,
    role: 'member',
    status: 'pending',
    expiresAt,
  });
}

test('a workspace deletion is claimed once and a live or recently deleted workspace cannot be purged', async () => {
  expect(await claimWorkspacePurge(workspaceId, cutoff)).toBeNull();
  expect(await db.transaction((tx) => claimWorkspaceDeletion(tx, workspaceId, new Date()))).toBe(
    true,
  );
  expect(await db.transaction((tx) => claimWorkspaceDeletion(tx, workspaceId, new Date()))).toBe(
    false,
  );
  expect(await finishWorkspaceDeletion(workspaceId)).toBe(true);
  expect(await finishWorkspaceDeletion(workspaceId)).toBe(false);
  expect(await claimWorkspacePurge(workspaceId, cutoff)).toBeNull();
});

test('a purged workspace can never be deleted or purged again', async () => {
  await db.transaction((tx) => claimWorkspaceDeletion(tx, workspaceId, old));
  await finishWorkspaceDeletion(workspaceId);
  const claimedAt = await claimWorkspacePurge(workspaceId, cutoff);
  expect(claimedAt).not.toBeNull();
  if (claimedAt === null) throw new Error('Expected purge claim');
  expect(await db.transaction((tx) => finishWorkspacePurge(tx, workspaceId, new Date(0)))).toBe(
    false,
  );
  expect(await db.transaction((tx) => finishWorkspacePurge(tx, workspaceId, claimedAt))).toBe(true);
  expect(await db.transaction((tx) => finishWorkspacePurge(tx, workspaceId, claimedAt))).toBe(
    false,
  );
  expect(await db.transaction((tx) => claimWorkspaceDeletion(tx, workspaceId, new Date()))).toBe(
    false,
  );
});

test('account deletion steps refuse stale replays and anonymizing erases the kept email', async () => {
  expect(await db.transaction((tx) => purgeAccount(tx, actor, cutoff))).toBe(false);
  expect(
    await db.transaction((tx) => tombstoneAccount(tx, actor, `${actor}@example.test`, old)),
  ).toBe(true);
  expect(await db.transaction((tx) => tombstoneAccount(tx, actor, 'stale@example.test', old))).toBe(
    false,
  );
  expect(await db.transaction((tx) => anonymizeAccount(tx, actor, cutoff))).toBe(true);
  expect(await db.transaction((tx) => anonymizeAccount(tx, actor, cutoff))).toBe(false);
  expect((await database.select().from(user).where(eq(user.id, actor))).at(0)).toMatchObject({
    accountStatus: 'anonymized',
    deletedEmail: null,
  });
  expect(await db.transaction((tx) => purgeAccount(tx, actor, cutoff))).toBe(true);
  expect(await db.transaction((tx) => purgeAccount(tx, actor, cutoff))).toBe(false);
});

test.each([
  'accepted',
  'rejected',
  'canceled',
] as const)('an invitation that ended as %s cannot change again', async (to) => {
  await addInvitation('invite-terminal', new Date(Date.now() + 86_400_000));
  expect(
    await db.transaction((tx) =>
      moveInvitation(tx, { invitationId: 'invite-terminal', to, now: new Date() }),
    ),
  ).not.toBeNull();
  for (const next of ['accepted', 'rejected', 'canceled'] as const) {
    expect(
      await db.transaction((tx) =>
        moveInvitation(tx, { invitationId: 'invite-terminal', to: next, now: new Date() }),
      ),
    ).toBeNull();
  }
});

test('an expired invitation cannot be accepted or add a member', async () => {
  await addInvitation('invite-expired', old);
  expect(
    await db.transaction((tx) =>
      acceptInvitationMember(tx, {
        invitationId: 'invite-expired',
        organizationId,
        userId: actor,
        sessionId: 'unused',
        expectedOrganizationId: null,
        role: 'member',
        plan: 'pro',
      }),
    ),
  ).toBe(false);
  expect((await database.select().from(invitation)).at(0)?.status).toBe('pending');
});

test('a role change refuses a stale starting role and a removed member', async () => {
  const move = {
    memberId: 'lifecycle-member',
    organizationId,
    from: 'owner' as const,
    to: 'admin' as const,
  };
  expect(await db.transaction((tx) => moveMemberRole(tx, move))).toBe(true);
  expect(await db.transaction((tx) => moveMemberRole(tx, move))).toBe(false);
  await database.delete(member).where(eq(member.id, move.memberId));
  expect(
    await db.transaction((tx) => moveMemberRole(tx, { ...move, from: 'admin', to: 'member' })),
  ).toBe(false);
});

test('removing a membership revokes every credential and moves every device in one step', async () => {
  await addSession('device-one', organizationId);
  await addSession('device-two', organizationId);
  await database
    .insert(integration)
    .values({ workspaceId, userId: actor, toolkit: 'gmail', status: 'connected' });
  expect(await db.transaction((tx) => removeMembership(tx, organizationId, actor))).toBe(true);
  expect(await db.transaction((tx) => removeMembership(tx, organizationId, actor))).toBe(false);
  expect(await database.select().from(workspaceMember)).toHaveLength(0);
  expect(await database.select().from(integration)).toHaveLength(0);
  expect((await database.select().from(integrationCleanup)).at(0)).toMatchObject({
    composioUserId: 'lifecycle-composio',
    vaultId: 'lifecycle-vault',
    memoryStoreId: 'lifecycle-memory',
    status: 'pending',
  });
  expect(
    (await database.select().from(auth_session)).map((session) => session.activeOrganizationId),
  ).toEqual([otherOrganizationId, otherOrganizationId]);
});

test('moving devices off a workspace keeps devices already elsewhere and clears ones with nowhere to go', async () => {
  await addSession('device-switched', otherOrganizationId);
  await addSession('device-deleted', organizationId);
  await database.delete(member).where(eq(member.organizationId, otherOrganizationId));
  await db.transaction((tx) => evacuateOrganizationSessions(tx, organizationId, actor));
  const sessions = await database.select().from(auth_session);
  expect(sessions.find((session) => session.id === 'device-switched')?.activeOrganizationId).toBe(
    otherOrganizationId,
  );
  expect(
    sessions.find((session) => session.id === 'device-deleted')?.activeOrganizationId,
  ).toBeNull();
});

test('two devices picking the same first workspace at once both succeed', async () => {
  await addSession('first-selection', null);
  const select = () =>
    db.transaction((tx) =>
      assignActiveOrganization(tx, {
        sessionId: 'first-selection',
        userId: actor,
        organizationId,
        expectedOrganizationId: null,
      }),
    );
  expect(await Promise.all([select(), select()])).toEqual([true, true]);
});

async function seedInvites() {
  await seedUser(database, 'inviter');
  await seedOrganization(database, 'invite-org');
  return {
    organizationId: 'invite-org',
    email: 'same@example.test',
    inviterId: 'inviter',
    expiresAt: new Date(Date.now() + 86400000),
  };
}

test('two pending invitations for one email in one workspace cannot both exist, whatever the letter case', async () => {
  const fields = await seedInvites();
  const outcomes = await Promise.allSettled([
    database.insert(invitation).values({ ...fields, id: 'first' }),
    database.insert(invitation).values({ ...fields, id: 'second', email: 'SAME@example.test' }),
  ]);
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  expect(await database.select().from(invitation)).toHaveLength(1);
  await database.insert(invitation).values({ ...fields, id: 'history', status: 'canceled' });
  await seedOrganization(database, 'another-org');
  await database
    .insert(invitation)
    .values({ ...fields, id: 'another-workspace', organizationId: 'another-org' });
});
