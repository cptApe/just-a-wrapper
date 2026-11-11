// Answering a workspace invitation through the public action, on real Better Auth sessions and Postgres.
import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { auth_session, invitation, member, workspace, workspaceMember } from '@/db/schema';
import { respondToInvitationAction } from '@/features/workspaces/api/invitation-actions';
import { applyMigrations, seedOrganization, truncateAll } from './helpers/schema-setup';
import { signInWithEmailCode } from './helpers/sign-in';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const requestHeaders = new AsyncLocalStorage<Headers>();
vi.mock('next/headers', () => ({
  headers: async () => {
    const headers = requestHeaders.getStore();
    if (headers === undefined) throw new Error('Missing test request headers');
    return headers;
  },
}));
const pool = makeTestPool();
const database = makeTestDb(pool);
const organizationId = 'invitation-response-org';
let ownerHeaders: Headers;
let inviteeHeaders: Headers;
let ownerId: string;
let inviteeId: string;

beforeAll(() => applyMigrations(database));
beforeEach(async () => {
  await truncateAll(database);
  const owner = await signInWithEmailCode('invitation-owner@example.test');
  const invitee = await signInWithEmailCode('invitation-guest@example.test');
  ownerHeaders = owner.headers;
  inviteeHeaders = invitee.headers;
  ownerId = owner.userId;
  inviteeId = invitee.userId;
  await seedOrganization(database, organizationId);
  await database.insert(workspace).values({
    organizationId,
    name: 'Invitations',
    planTier: 'pro',
    planBillingInterval: 'month',
    planCredits: 400,
    stripeSubscriptionId: 'sub_invitation',
  });
  await database.insert(member).values({
    id: 'response-owner-member',
    organizationId,
    userId: ownerId,
    role: 'owner',
    createdAt: new Date(),
  });
  await database.insert(invitation).values({
    id: 'response-invitation',
    organizationId,
    inviterId: ownerId,
    email: 'invitation-guest@example.test',
    role: 'member',
    status: 'pending',
    expiresAt: new Date(Date.now() + 86_400_000),
  });
});
afterAll(() => pool.end());

function respond(headers: Headers, decision: 'accepted' | 'canceled') {
  return requestHeaders.run(headers, () =>
    respondToInvitationAction({ invitationId: 'response-invitation', decision }),
  );
}

test('an accept racing a cancel leaves the membership matching the final invitation state', async () => {
  await Promise.all([respond(inviteeHeaders, 'accepted'), respond(ownerHeaders, 'canceled')]);
  const stored = (await database.select().from(invitation)).at(0);
  const memberships = await database
    .select()
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, inviteeId)));
  expect(stored?.status === 'accepted' || stored?.status === 'canceled').toBe(true);
  expect(memberships).toHaveLength(stored?.status === 'accepted' ? 1 : 0);
  const lateCancel = await respond(ownerHeaders, 'canceled');
  expect(lateCancel.ok).toBe(false);
  expect((await database.select().from(invitation)).at(0)?.status).toBe(stored?.status);
});

test('accepting an invitation to a deleted workspace adds no member and does not switch the session', async () => {
  await database
    .update(workspace)
    .set({ lifecycleStatus: 'deleted', deletedAt: new Date() })
    .where(eq(workspace.organizationId, organizationId));
  const response = await respond(inviteeHeaders, 'accepted');
  expect(response).toMatchObject({ ok: false, code: 'WORKSPACE_NOT_FOUND' });
  expect(await database.select().from(member).where(eq(member.userId, inviteeId))).toHaveLength(0);
  expect(
    await database.select().from(workspaceMember).where(eq(workspaceMember.userId, inviteeId)),
  ).toHaveLength(0);
  expect(
    (await database.select().from(auth_session).where(eq(auth_session.userId, inviteeId))).every(
      (session) => session.activeOrganizationId !== organizationId,
    ),
  ).toBe(true);
});

test('a double-clicked accept creates one membership and a replay finishes provisioning', async () => {
  const responses = await Promise.all([
    respond(inviteeHeaders, 'accepted'),
    respond(inviteeHeaders, 'accepted'),
  ]);
  expect(responses.some((response) => response.ok)).toBe(true);
  expect(await database.select().from(member).where(eq(member.userId, inviteeId))).toHaveLength(1);
  expect((await database.select().from(invitation)).at(0)?.status).toBe('accepted');
  expect((await respond(inviteeHeaders, 'accepted')).ok).toBe(true);
  expect(
    await database.select().from(workspaceMember).where(eq(workspaceMember.userId, inviteeId)),
  ).toHaveLength(1);
});

test('a provisioning failure after accepting does not undo the membership', async () => {
  await database.execute(sql`alter table workspace_member rename to workspace_member_unavailable`);
  try {
    expect(await respond(inviteeHeaders, 'accepted')).toEqual({ ok: true, data: undefined });
    expect((await database.select().from(invitation)).at(0)?.status).toBe('accepted');
    expect(await database.select().from(member).where(eq(member.userId, inviteeId))).toHaveLength(
      1,
    );
  } finally {
    await database.execute(
      sql`alter table workspace_member_unavailable rename to workspace_member`,
    );
  }
});
