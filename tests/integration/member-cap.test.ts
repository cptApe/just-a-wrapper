// The plan's member cap through the real Better Auth server: a pending invitation holds a seat.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { membersMessage } from '@/features/billing/lib/plan-gates';
import { PLANS } from '@/features/billing/pricing-config';
import { countWorkspaceSeats } from '@/features/workspaces/api/members';
import { auth } from '@/lib/auth';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, truncateAll } from './helpers/schema-setup';
import { signInWithEmailCode } from './helpers/sign-in';
import { makeTestDb, makeTestPool } from './helpers/test-db';
import { acceptTestInvitation, createTestWorkspace } from './helpers/workspace-actions';

// Better Auth checks its membership limit only at accept time, so without our invitation hook an
// admin could send any number of invitations and the refusal would land on the invitee.

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const pool = makeTestPool();
const db = makeTestDb(pool);
const OWNER_EMAIL = 'owner@member-cap.test';

beforeAll(() => applyMigrations(db));
beforeEach(() => truncateAll(db));
afterAll(() => pool.end());

/** An organization owned by OWNER_EMAIL, its workspace put on `plan` by hand. */
async function setUpOrg(plan: 'none' | 'pro') {
  const { headers: ownerHeaders } = await signInWithEmailCode(OWNER_EMAIL);
  const org = await createTestWorkspace({
    body: { name: 'Cap Team', slug: 'cap-team' },
    headers: ownerHeaders,
  });
  if (!org) throw new Error('createOrganization returned null');
  await auth.api.setActiveOrganization({ body: { organizationId: org.id }, headers: ownerHeaders });
  if (plan === 'pro')
    await db.execute(
      sql`update workspace set plan_tier = 'pro', plan_billing_interval = 'month', plan_credits = 400, stripe_subscription_id = 'sub_' || id
          where organization_id = ${org.id}`,
    );
  return { ownerHeaders, organizationId: org.id };
}

function invite(email: string, organizationId: string, headers: Headers) {
  return auth.api.createInvitation({ body: { email, role: 'member', organizationId }, headers });
}

async function fillWithInvites(count: number, organizationId: string, headers: Headers) {
  const sent = [];
  for (let i = 0; i < count; i += 1)
    sent.push(await invite(`invitee-${i}@member-cap.test`, organizationId, headers));
  return sent;
}

describe('the member cap counts pending invitations', () => {
  test('a Pro workspace with one member and four pending invitations cannot invite a sixth seat', async () => {
    const { ownerHeaders, organizationId } = await setUpOrg('pro');
    expect(PLANS.pro.limits.members).toBe(5);
    await fillWithInvites(4, organizationId, ownerHeaders);
    expect(await countWorkspaceSeats(organizationId)).toEqual({
      members: 1,
      pendingInvitations: 4,
    });

    // The request the invite modal makes, so this is the body the inviter's browser reads.
    const response = await auth.handler(
      new Request('http://localhost:3000/api/auth/organization/invite-member', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: ownerHeaders.get('cookie') ?? '' },
        body: JSON.stringify({
          email: 'one-too-many@member-cap.test',
          role: 'member',
          organizationId,
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED',
      message: membersMessage({ limits: PLANS.pro.limits, biggerPlan: false }),
    });

    const { rows } = await db.execute<{ total: number }>(
      sql`select count(*)::int as total from invitation where organization_id = ${organizationId}`,
    );
    expect(requiredRow(rows.at(0)).total).toBe(4);
  });

  test('cancelling a pending invitation frees the seat it held', async () => {
    const { ownerHeaders, organizationId } = await setUpOrg('pro');
    const pending = await fillWithInvites(4, organizationId, ownerHeaders);
    await expect(invite('blocked@member-cap.test', organizationId, ownerHeaders)).rejects.toThrow();

    await auth.api.cancelInvitation({
      body: { invitationId: requiredRow(pending.at(0)).id },
      headers: ownerHeaders,
    });

    const replacement = await invite('replacement@member-cap.test', organizationId, ownerHeaders);
    expect(replacement.email).toBe('replacement@member-cap.test');
  });

  test('an invitee can still accept when the pending invitations fill the plan', async () => {
    const { ownerHeaders, organizationId } = await setUpOrg('pro');
    const [first] = await fillWithInvites(4, organizationId, ownerHeaders);
    const { headers: joinerHeaders } = await signInWithEmailCode('invitee-0@member-cap.test');

    await acceptTestInvitation({
      body: { invitationId: requiredRow([first].at(0)).id },
      headers: joinerHeaders,
    });

    expect(await countWorkspaceSeats(organizationId)).toEqual({
      members: 2,
      pendingInvitations: 3,
    });
  });

  test('a workspace with no plan invites past the largest capped seat count', async () => {
    const { ownerHeaders, organizationId } = await setUpOrg('none');
    const seatsPastPro = (PLANS.pro.limits.members ?? 0) + 1;
    await fillWithInvites(seatsPastPro, organizationId, ownerHeaders);
    expect(await countWorkspaceSeats(organizationId)).toEqual({
      members: 1,
      pendingInvitations: seatsPastPro,
    });
  });
});
