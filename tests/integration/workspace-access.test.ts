import { acceptTestInvitation, createTestWorkspace } from './helpers/workspace-actions';

// Framework scheduling is held until after the action response, as in production.
vi.mock('next/server', () => ({ after: vi.fn() }));
// The shipped welcome grant is 0; a positive amount is the only way to see the grant read back.
vi.mock('@/features/billing/pricing-config', async (actual) =>
  (await import('./helpers/seams')).pricingWith(actual, { WELCOME_CREDITS: 100 }),
);

import { APIError } from 'better-auth/api';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { getBillingSummary } from '@/features/billing/api/get-billing-summary';
import { requireBillingAdmin } from '@/features/billing/api/resolve-workspace';
import { CREDITS_ONLY_RULES } from '@/features/billing/credits-only/rules';
import { WELCOME_CREDITS } from '@/features/billing/pricing-config';
import {
  loadMemoryBrowsePage,
  loadMemoryNote,
  loadMemoryNoteVersions,
  loadMemoryTrash,
  previewMemoryNoteVersion,
} from '@/features/memory/api/actions';
import { resolveScopedStore } from '@/features/memory/api/store-access';
import { loadMemorySurface } from '@/features/memory/api/surface';
import { leaveWorkspaceMembership } from '@/features/workspaces/api/leave-workspace-membership';
import { removeWorkspaceMember } from '@/features/workspaces/api/remove-workspace-member';
import { updateWorkspaceMemberRole } from '@/features/workspaces/api/update-workspace-member-role';
import { auth } from '@/lib/auth';
import { resolveCaller } from '@/lib/caller';
import { withRequestContext } from '@/lib/request-context';
import { seedCreditBalance } from './helpers/billing-ledger';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, truncateAll } from './helpers/schema-setup';
import { signInWithEmailCode } from './helpers/sign-in';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const routeState = vi.hoisted(() => ({
  headers: new Headers(),
  transcribeAudio: vi.fn(async () => ({ text: 'should not run', audioSeconds: 1 })),
}));
vi.mock('next/headers', () => ({ headers: async () => routeState.headers }));
vi.mock('@/features/voice/api/transcribe-audio', () => ({
  transcribeAudio: routeState.transcribeAudio,
}));

const { POST: transcribePost } = await import('@/app/api/transcribe/route');
const { PATCH: autoTopupPatch } = await import('@/app/api/billing/auto-topup/route');
const { POST: reconcileBillingPost } = await import('@/app/api/billing/reconcile/route');
const { PATCH: memberLimitPatch } = await import('@/app/api/billing/member-limit/route');
const { GET: portalGet } = await import('@/app/api/billing/portal/route');
const { POST: topupPost } = await import('@/app/api/billing/topup/route');

// Who may do what in a shared workspace, through the real Better Auth server, its organization
// access control and the app's own gates on the test Postgres. No permission check is mocked.

const pool = makeTestPool();
const db = makeTestDb(pool);

beforeAll(async () => {
  await applyMigrations(db);
});

beforeEach(async () => {
  await truncateAll(db);
  routeState.headers = new Headers();
  routeState.transcribeAudio.mockClear();
});

afterAll(async () => {
  await pool.end();
});

async function signIn(email: string): Promise<Headers> {
  return (await signInWithEmailCode(email)).headers;
}

const OWNER_EMAIL = 'owner@authz.test';
const MEMBER_EMAIL = 'member@authz.test';
const SECOND_OWNER_EMAIL = 'second-owner@authz.test';

async function setUpSharedOrg(): Promise<{
  ownerHeaders: Headers;
  memberHeaders: Headers;
  organizationId: string;
}> {
  const ownerHeaders = await signIn(OWNER_EMAIL);
  const org = await createTestWorkspace({
    body: { name: 'Authz Team', slug: 'authz-team' },
    headers: ownerHeaders,
  });
  if (!org) throw new Error('createOrganization returned null');
  await auth.api.setActiveOrganization({
    body: { organizationId: org.id },
    headers: ownerHeaders,
  });
  // A shared workspace needs a plan with seats for invited members.
  await db.execute(
    sql`update workspace set plan_tier = 'pro', plan_billing_interval = 'month', plan_credits = 400, stripe_subscription_id = 'sub_' || id
        where organization_id = ${org.id}`,
  );

  const invitation = await auth.api.createInvitation({
    body: { email: MEMBER_EMAIL, role: 'member', organizationId: org.id },
    headers: ownerHeaders,
  });

  const memberHeaders = await signIn(MEMBER_EMAIL);
  // The app action joins and provisions the invitee after committing membership.
  await acceptTestInvitation({
    body: { invitationId: invitation.id },
    headers: memberHeaders,
  });

  return { ownerHeaders, memberHeaders, organizationId: org.id };
}

describe('joining a workspace', () => {
  test('an accepted invite leaves the new member provisioned and the invitation used up', async () => {
    const { organizationId } = await setUpSharedOrg();

    const members = (
      await db.execute<{
        user_id: string;
        composio_user_id: string;
        provisioning_status: string;
      }>(
        sql`select wm.user_id, wm.composio_user_id, wm.provisioning_status
            from workspace_member wm where wm.organization_id = ${organizationId}`,
      )
    ).rows;
    expect(members).toHaveLength(2);
    for (const m of members) {
      expect(m.composio_user_id).toBeTruthy();
      expect(m.provisioning_status).toBe('ready');
    }

    // And the invitation row is consumed.
    const { status } = requiredRow(
      (
        await db.execute<{ status: string }>(
          sql`select status from invitation where organization_id = ${organizationId} and email = ${MEMBER_EMAIL}`,
        )
      ).rows.at(0),
    );
    expect(status).toBe('accepted');
  });
});

describe('owner and admin actions', () => {
  test.each([
    '/organization/update-member-role',
    '/organization/remove-member',
    '/organization/leave',
  ])('the raw Better Auth endpoint %s cannot bypass the app membership rules', async (path) => {
    const response = await auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(response.status).toBe(404);
  });

  test('a plain member cannot invite, cancel invitations or pass the admin gates', () =>
    withRequestContext({ route: 'test-billing-admin-authz' }, async () => {
      const { ownerHeaders, memberHeaders, organizationId } = await setUpSharedOrg();

      // Member invites someone → Better Auth's access control must 403.
      await expect(
        auth.api.createInvitation({
          body: { email: 'third@authz.test', role: 'member', organizationId },
          headers: memberHeaders,
        }),
      ).rejects.toSatisfy((e: unknown) => e instanceof APIError && e.statusCode === 403);

      // Owner creates a pending invite; member tries to cancel it → 403.
      const pending = await auth.api.createInvitation({
        body: { email: 'third@authz.test', role: 'member', organizationId },
        headers: ownerHeaders,
      });
      await expect(
        auth.api.cancelInvitation({
          body: { invitationId: pending.id },
          headers: memberHeaders,
        }),
      ).rejects.toSatisfy((e: unknown) => e instanceof APIError && e.statusCode === 403);

      // Our own workspace-edit gate (backs the rename server action) refuses the
      // member with FORBIDDEN and admits the owner.
      await expect(resolveCaller(memberHeaders, { atLeast: 'admin' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(requireBillingAdmin(memberHeaders)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(resolveCaller(ownerHeaders, { atLeast: 'admin' })).resolves.toMatchObject({
        organizationId,
        role: 'owner',
      });
      await expect(requireBillingAdmin(ownerHeaders)).resolves.toMatchObject({
        organizationId,
        userEmail: OWNER_EMAIL,
      });
    }));

  test.each([
    {
      name: 'auto top-up settings',
      run: () =>
        autoTopupPatch(
          new Request('http://localhost/api/billing/auto-topup', {
            method: 'PATCH',
            body: JSON.stringify({
              enabled: false,
              thresholdCredits: 100,
              credits: 400,
              monthlyCapDollars: 0,
            }),
          }),
        ),
    },
    {
      name: 'top-up confirmation',
      run: () =>
        reconcileBillingPost(
          new Request('http://localhost/api/billing/reconcile', {
            method: 'POST',
            body: JSON.stringify({ checkoutSessionId: 'cs_test_authz' }),
          }),
        ),
    },
    {
      name: 'member spending limit',
      run: () =>
        memberLimitPatch(
          new Request('http://localhost/api/billing/member-limit', {
            method: 'PATCH',
            body: JSON.stringify({ userId: 'member', creditLimit: 100 }),
          }),
        ),
    },
    {
      name: 'billing portal',
      run: () => portalGet(new Request('http://localhost/api/billing/portal')),
    },
    {
      name: 'credit top-up',
      run: () =>
        topupPost(
          new Request('http://localhost/api/billing/topup', {
            method: 'POST',
            body: JSON.stringify({
              expectedOrganizationId: 'rendered-org',
              credits: 1000,
              idempotencyKey: 'authz-test',
              attemptCreatedAt: Date.now(),
            }),
          }),
        ),
    },
  ])('a plain member cannot change $name', async ({ run }) => {
    const { memberHeaders } = await setUpSharedOrg();
    routeState.headers = memberHeaders;

    const response = await run();

    expect(response.status).toBe(403);
  });

  test('reading billing on a new workspace shows the welcome credits once and never mints more', () =>
    withRequestContext({ route: 'test-no-plan-billing-summary' }, async () => {
      // Its own solo owner: the shared org above is on a plan so it can have
      // members, and this assertion is about the state before anyone pays.
      const ownerHeaders = await signIn('solo@authz.test');
      const org = await createTestWorkspace({
        body: { name: 'Solo', slug: 'solo-no-plan' },
        headers: ownerHeaders,
      });
      if (!org) throw new Error('createOrganization returned null');
      await auth.api.setActiveOrganization({
        body: { organizationId: org.id },
        headers: ownerHeaders,
      });

      const summary = await getBillingSummary(ownerHeaders);
      const secondRead = await getBillingSummary(ownerHeaders);

      expect(summary).toMatchObject({
        planTier: 'none',
        planCredits: null,
        planName: 'No plan',
        creditBalance: WELCOME_CREDITS,
        planLimits: CREDITS_ONLY_RULES.noPlanLimits,
        sellsPlans: false,
      });
      // Reading the page never mints credits: the welcome grant is issued once,
      // at provisioning, and a second read sees the same balance.
      expect(secondRead).toMatchObject({ creditBalance: WELCOME_CREDITS });
      const { count } = requiredRow(
        (
          await db.execute<{ count: number }>(
            sql`select count(*)::int as count from credit_grant where source = 'welcome'`,
          )
        ).rows.at(0),
      );
      expect(count).toBe(1);
    }));

  test('an owner can invite the same email again after cancelling', async () => {
    const { ownerHeaders, organizationId } = await setUpSharedOrg();

    const first = await auth.api.createInvitation({
      body: { email: 'fourth@authz.test', role: 'member', organizationId },
      headers: ownerHeaders,
    });
    await auth.api.cancelInvitation({
      body: { invitationId: first.id },
      headers: ownerHeaders,
    });
    const { status } = requiredRow(
      (
        await db.execute<{ status: string }>(
          sql`select status from invitation where id = ${first.id}`,
        )
      ).rows.at(0),
    );
    expect(status).toBe('canceled');

    // Re-inviting after cancel must create a fresh pending invitation (only
    // PENDING duplicates are rejected by the invite endpoint).
    const second = await auth.api.createInvitation({
      body: { email: 'fourth@authz.test', role: 'member', organizationId },
      headers: ownerHeaders,
    });
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('pending');
  });
});

describe('member credit limits', () => {
  test('a member at their credit limit cannot run paid dictation', async () => {
    const { ownerHeaders, organizationId } = await setUpSharedOrg();
    routeState.headers = ownerHeaders;
    await db.execute(
      sql`update workspace
          set plan_tier = 'max', plan_billing_interval = 'month', plan_credits = 2000,
              credit_reset_at = now()
          where organization_id = ${organizationId}`,
    );
    const funding = await db.execute<{ id: string }>(
      sql`select id from workspace where organization_id = ${organizationId}`,
    );
    await seedCreditBalance(db, requiredRow(funding.rows.at(0)).id, 100);
    await db.execute(
      sql`update workspace_member
          set credit_limit = 0
          where organization_id = ${organizationId}`,
    );
    const form = new FormData();
    form.set('audio', new File([new Uint8Array([1])], 'voice.webm', { type: 'audio/webm' }));
    form.set('durationSeconds', '1');

    const response = await transcribePost(
      new Request('http://localhost/api/transcribe', { method: 'POST', body: form }),
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'CREDITS_EXHAUSTED', reason: 'member_limit' },
    });
    expect(routeState.transcribeAudio).not.toHaveBeenCalled();
    const { balance, charges } = requiredRow(
      (
        await db.execute<{ balance: number; charges: number }>(
          sql`select (select coalesce(sum(amount - consumed), 0)::int from credit_grant where workspace_id = w.id and status = 'issued' and issued_at <= now() and expires_at > now()) as balance,
                   count(ue.id)::int as charges
            from workspace w
            left join usage_event ue on ue.workspace_id = w.id
            where w.organization_id = ${organizationId}
            group by w.id`,
        )
      ).rows.at(0),
    );
    expect({ balance, charges }).toEqual({ balance: 100, charges: 0 });
  });
});

describe('a workspace always keeps an owner', () => {
  test('the only owner cannot demote themselves', async () => {
    const { ownerHeaders, organizationId } = await setUpSharedOrg();
    const { id: ownerMemberId } = requiredRow(
      (
        await db.execute<{ id: string }>(
          sql`select m.id from member m join "user" u on u.id = m.user_id
            where m.organization_id = ${organizationId} and u.email = ${OWNER_EMAIL}`,
        )
      ).rows.at(0),
    );

    await expect(
      updateWorkspaceMemberRole({ memberId: ownerMemberId, role: 'admin' }, ownerHeaders),
    ).rejects.toMatchObject({ code: 'SOLE_OWNER_BLOCKED' });
  });

  test.each([
    'admin',
    'member',
  ] as const)('an owner can step down to %s once someone else is an owner', async (nextRole) => {
    const { ownerHeaders, organizationId } = await setUpSharedOrg();
    const invitation = await auth.api.createInvitation({
      body: { email: SECOND_OWNER_EMAIL, role: 'owner', organizationId },
      headers: ownerHeaders,
    });
    const secondOwnerHeaders = await signIn(SECOND_OWNER_EMAIL);
    await acceptTestInvitation({
      body: { invitationId: invitation.id },
      headers: secondOwnerHeaders,
    });
    const { id: ownerMemberId } = requiredRow(
      (
        await db.execute<{ id: string }>(
          sql`select m.id from member m join "user" u on u.id = m.user_id
            where m.organization_id = ${organizationId} and u.email = ${OWNER_EMAIL}`,
        )
      ).rows.at(0),
    );

    await updateWorkspaceMemberRole({ memberId: ownerMemberId, role: nextRole }, ownerHeaders);

    const { role } = requiredRow(
      (
        await db.execute<{ role: string }>(sql`select role from member where id = ${ownerMemberId}`)
      ).rows.at(0),
    );
    expect(role).toBe(nextRole);
  });

  test('an admin cannot demote an owner', async () => {
    const { ownerHeaders, memberHeaders, organizationId } = await setUpSharedOrg();
    const rows = (
      await db.execute<{ id: string; email: string }>(
        sql`select m.id, u.email from member m join "user" u on u.id = m.user_id
            where m.organization_id = ${organizationId}`,
      )
    ).rows;
    const ownerMemberId = rows.find((row) => row.email === OWNER_EMAIL)?.id;
    const adminMemberId = rows.find((row) => row.email === MEMBER_EMAIL)?.id;
    if (!ownerMemberId || !adminMemberId) throw new Error('expected owner and member rows');

    await auth.api.updateMemberRole({
      body: { memberId: adminMemberId, role: 'admin', organizationId },
      headers: ownerHeaders,
    });
    await expect(
      updateWorkspaceMemberRole({ memberId: ownerMemberId, role: 'member' }, memberHeaders),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('an admin cannot remove themselves through member removal', async () => {
    const { ownerHeaders, memberHeaders, organizationId } = await setUpSharedOrg();
    const rows = (
      await db.execute<{ id: string; email: string }>(
        sql`select m.id, u.email from member m join "user" u on u.id = m.user_id
            where m.organization_id = ${organizationId}`,
      )
    ).rows;
    const adminMemberId = rows.find((row) => row.email === MEMBER_EMAIL)?.id;
    if (!adminMemberId) throw new Error('expected member row');
    await auth.api.updateMemberRole({
      body: { memberId: adminMemberId, role: 'admin', organizationId },
      headers: ownerHeaders,
    });

    const failure = await withRequestContext({ route: 'test-remove-self' }, () =>
      removeWorkspaceMember({ memberId: adminMemberId }, memberHeaders),
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ code: 'VALIDATION_FAILED' });
    const { count } = requiredRow(
      (
        await db.execute<{ count: number }>(
          sql`select count(*)::int as count from member where id = ${adminMemberId}`,
        )
      ).rows.at(0),
    );
    expect(count).toBe(1);
  });

  test('two owners cannot concurrently demote each other and leave the workspace ownerless', async () => {
    const { ownerHeaders, organizationId } = await setUpSharedOrg();
    const invitation = await auth.api.createInvitation({
      body: { email: SECOND_OWNER_EMAIL, role: 'owner', organizationId },
      headers: ownerHeaders,
    });
    const secondOwnerHeaders = await signIn(SECOND_OWNER_EMAIL);
    await acceptTestInvitation({
      body: { invitationId: invitation.id },
      headers: secondOwnerHeaders,
    });
    const rows = (
      await db.execute<{ id: string; email: string }>(
        sql`select m.id, u.email from member m join "user" u on u.id = m.user_id
            where m.organization_id = ${organizationId} and m.role = 'owner'`,
      )
    ).rows;
    const firstOwnerId = rows.find((row) => row.email === OWNER_EMAIL)?.id;
    const secondOwnerId = rows.find((row) => row.email === SECOND_OWNER_EMAIL)?.id;
    if (!firstOwnerId || !secondOwnerId) throw new Error('expected two owner rows');

    const results = await Promise.allSettled([
      updateWorkspaceMemberRole({ memberId: secondOwnerId, role: 'admin' }, ownerHeaders),
      updateWorkspaceMemberRole({ memberId: firstOwnerId, role: 'admin' }, secondOwnerHeaders),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status !== 'rejected') throw new Error('expected one rejected role change');
    expect(['SOLE_OWNER_BLOCKED', 'FORBIDDEN']).toContain(rejected.reason?.code);

    const { count } = requiredRow(
      (
        await db.execute<{ count: number }>(
          sql`select count(*)::int as count from member
            where organization_id = ${organizationId} and role = 'owner'`,
        )
      ).rows.at(0),
    );
    expect(count).toBe(1);
  });

  test('two owners cannot concurrently remove each other and leave the workspace ownerless', async () => {
    const { ownerHeaders, organizationId } = await setUpSharedOrg();
    const invitation = await auth.api.createInvitation({
      body: { email: SECOND_OWNER_EMAIL, role: 'owner', organizationId },
      headers: ownerHeaders,
    });
    const secondOwnerHeaders = await signIn(SECOND_OWNER_EMAIL);
    await acceptTestInvitation({
      body: { invitationId: invitation.id },
      headers: secondOwnerHeaders,
    });
    const rows = (
      await db.execute<{ id: string; email: string }>(
        sql`select m.id, u.email from member m join "user" u on u.id = m.user_id
            where m.organization_id = ${organizationId} and m.role = 'owner'`,
      )
    ).rows;
    const firstOwnerId = rows.find((row) => row.email === OWNER_EMAIL)?.id;
    const secondOwnerId = rows.find((row) => row.email === SECOND_OWNER_EMAIL)?.id;
    if (!firstOwnerId || !secondOwnerId) throw new Error('expected two owner rows');

    const results = await Promise.allSettled([
      withRequestContext({ route: 'test-remove-first' }, () =>
        removeWorkspaceMember({ memberId: secondOwnerId }, ownerHeaders),
      ),
      withRequestContext({ route: 'test-remove-second' }, () =>
        removeWorkspaceMember({ memberId: firstOwnerId }, secondOwnerHeaders),
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const { count } = requiredRow(
      (
        await db.execute<{ count: number }>(
          sql`select count(*)::int as count from member
            where organization_id = ${organizationId} and role = 'owner'`,
        )
      ).rows.at(0),
    );
    expect(count).toBe(1);
  });

  test('two owners cannot concurrently leave and leave the workspace ownerless', async () => {
    const { ownerHeaders, organizationId } = await setUpSharedOrg();
    const invitation = await auth.api.createInvitation({
      body: { email: SECOND_OWNER_EMAIL, role: 'owner', organizationId },
      headers: ownerHeaders,
    });
    const secondOwnerHeaders = await signIn(SECOND_OWNER_EMAIL);
    await acceptTestInvitation({
      body: { invitationId: invitation.id },
      headers: secondOwnerHeaders,
    });

    await createTestWorkspace({
      body: { name: 'Owner fallback', slug: 'owner-fallback' },
      headers: ownerHeaders,
    });
    await createTestWorkspace({
      body: { name: 'Second owner fallback', slug: 'second-owner-fallback' },
      headers: secondOwnerHeaders,
    });
    await Promise.all([
      auth.api.setActiveOrganization({ body: { organizationId }, headers: ownerHeaders }),
      auth.api.setActiveOrganization({ body: { organizationId }, headers: secondOwnerHeaders }),
    ]);

    const results = await Promise.allSettled([
      withRequestContext({ route: 'test-leave-first' }, () =>
        leaveWorkspaceMembership(ownerHeaders, organizationId),
      ),
      withRequestContext({ route: 'test-leave-second' }, () =>
        leaveWorkspaceMembership(secondOwnerHeaders, organizationId),
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status !== 'rejected') throw new Error('expected one rejected workspace leave');
    expect(rejected.reason?.code).toBe('SOLE_OWNER_BLOCKED');

    const { count } = requiredRow(
      (
        await db.execute<{ count: number }>(
          sql`select count(*)::int as count from member
            where organization_id = ${organizationId} and role = 'owner'`,
        )
      ).rows.at(0),
    );
    expect(count).toBe(1);
  });
});

test('a tab left open on another workspace cannot start chats, buy credits, rename or leave', async () => {
  const { ownerHeaders, organizationId } = await setUpSharedOrg();
  routeState.headers = ownerHeaders;
  const { POST: createSession } = await import('@/app/api/sessions/route');
  const { updateWorkspaceNameAction } = await import('@/features/workspaces/api/actions');
  for (const [route, handler, payload] of [
    ['sessions', createSession, { message: 'Private workspace A message' }],
    [
      'billing/topup',
      topupPost,
      { credits: 1000, idempotencyKey: 'stale', attemptCreatedAt: Date.now() },
    ],
    [
      'billing/auto-topup',
      autoTopupPatch,
      { enabled: false, thresholdCredits: 100, credits: 1000, monthlyCapDollars: 100 },
    ],
    ['billing/member-limit', memberLimitPatch, { userId: 'target-member', creditLimit: 100 }],
  ] as const) {
    const response = await handler(
      new Request(`http://localhost/api/${route}`, {
        method: 'POST',
        body: JSON.stringify({ ...payload, expectedOrganizationId: 'workspace-from-stale-tab' }),
      }),
    );
    expect(response.status, route).toBe(409);
    expect((await response.json()).error.code, route).toBe('WORKSPACE_CHANGED');
  }
  expect(
    await updateWorkspaceNameAction('Wrong workspace', 'workspace-from-stale-tab'),
  ).toMatchObject({ ok: false, code: 'WORKSPACE_CHANGED' });
  await expect(
    withRequestContext({ route: 'test/stale-leave' }, () =>
      leaveWorkspaceMembership(ownerHeaders, 'workspace-from-stale-tab'),
    ),
  ).rejects.toMatchObject({ code: 'WORKSPACE_CHANGED' });
  expect(
    (await db.execute(sql`select name from organization where id = ${organizationId}`)).rows.at(0)
      ?.name,
  ).toBe('Authz Team');
});

describe('removed members', () => {
  test('a removed member whose session is still valid cannot read either memory store', () =>
    withRequestContext({ route: 'test-memory-removed-member' }, async () => {
      const { memberHeaders, organizationId } = await setUpSharedOrg();
      routeState.headers = memberHeaders;
      const session = await auth.api.getSession({ headers: memberHeaders });
      expect(session).not.toBeNull();
      if (!session) throw new Error('expected a signed-in member');
      await db.execute(sql`update workspace set workspace_memory_store_id = 'memstore_workspace'
        where organization_id = ${organizationId}`);
      await db.execute(sql`update workspace_member set user_memory_store_id = 'memstore_user'
        where organization_id = ${organizationId} and user_id = ${session.user.id}`);
      await expect(resolveScopedStore(memberHeaders, 'workspace')).resolves.toMatchObject({
        storeId: 'memstore_workspace',
        canEdit: false,
      });
      await expect(resolveScopedStore(memberHeaders, 'you')).resolves.toMatchObject({
        storeId: 'memstore_user',
        canEdit: true,
      });

      // Preserve both store mappings and the live session: membership alone must
      // deny access, independently of the removal action's session cleanup.
      await db.execute(sql`delete from member where organization_id = ${organizationId}
        and user_id = ${session.user.id}`);
      await expect(auth.api.getSession({ headers: memberHeaders })).resolves.toMatchObject({
        user: { id: session.user.id },
        session: { activeOrganizationId: organizationId },
      });

      for (const scope of ['you', 'workspace'] as const) {
        await expect(resolveScopedStore(memberHeaders, scope)).rejects.toMatchObject({
          code: 'WORKSPACE_NOT_FOUND',
        });
        await expect(
          loadMemorySurface(memberHeaders, scope, { accessOnly: false }),
        ).rejects.toMatchObject({
          code: 'WORKSPACE_NOT_FOUND',
        });
        for (const read of [
          () => loadMemoryBrowsePage(scope, '/', null),
          () => loadMemoryNote(scope, 'mem_note'),
          () => loadMemoryNoteVersions(scope, 'mem_note', null),
          () => previewMemoryNoteVersion(scope, 'memver_note'),
          () => loadMemoryTrash(scope, null),
        ]) {
          await expect(read()).resolves.toMatchObject({ ok: false, code: 'WORKSPACE_NOT_FOUND' });
        }
      }
    }));

  test('removing a member signs every device out of that workspace but keeps them signed in', () =>
    withRequestContext({ route: 'test-memory-session-revocation' }, async () => {
      const { ownerHeaders, memberHeaders, organizationId } = await setUpSharedOrg();
      const session = await auth.api.getSession({ headers: memberHeaders });
      if (!session) throw new Error('expected a signed-in member');
      const target = (
        await db.execute<{ id: string }>(sql`select id from member
        where organization_id = ${organizationId} and user_id = ${session.user.id}`)
      ).rows.at(0);
      expect(target).toBeDefined();
      if (!target) throw new Error('Expected the workspace member');
      // A second browser must also leave this workspace. Sessions
      // with another active organization or no active organization must survive.
      for (const [id, activeOrg] of [
        ['second-workspace-session', organizationId],
        ['other-workspace-session', 'other-organization'],
        ['unscoped-session', null],
      ] as const) {
        await db.execute(sql`insert into auth_session
          (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
          values (${id}, ${id}, ${session.user.id}, ${activeOrg}, now() + interval '1 day', now(), now())`);
      }

      await removeWorkspaceMember({ memberId: target.id }, ownerHeaders);

      const remaining = (
        await db.execute<{ id: string }>(sql`select id from auth_session
        where user_id = ${session.user.id} order by id`)
      ).rows.map((row) => row.id);
      expect(remaining).toEqual(
        [
          session.session.id,
          'other-workspace-session',
          'second-workspace-session',
          'unscoped-session',
        ].sort(),
      );
      const stillActive = await db.execute(
        sql`select id from auth_session where user_id = ${session.user.id} and active_organization_id = ${organizationId}`,
      );
      expect(stillActive.rows).toHaveLength(0);
      await expect(auth.api.getSession({ headers: memberHeaders })).resolves.toMatchObject({
        session: { activeOrganizationId: null },
      });
      await expect(auth.api.getSession({ headers: ownerHeaders })).resolves.toMatchObject({
        session: { activeOrganizationId: organizationId },
      });
      const mappings = (
        await db.execute(sql`select user_id from workspace_member
        where organization_id = ${organizationId} and user_id = ${session.user.id}`)
      ).rows;
      expect(mappings).toHaveLength(0);
    }));
});
