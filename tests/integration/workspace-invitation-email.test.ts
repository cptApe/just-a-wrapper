// Whether an invitation email went out, through real Better Auth (in-memory adapter) and the real
// email wrapper, which reads the deployment settings in Postgres. Only Resend's HTTP boundary is faked.
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { applyMigrations, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

process.env.RESEND_API_KEY = 're_test_invitation';
const { betterAuth } = await import('better-auth');
const { organization } = await import('better-auth/plugins');
const { memoryAdapter } = await import('better-auth/adapters/memory');
const { sendInvitationEmail } = await import('@/features/workspaces/api/invitation-email');

const pool = makeTestPool();
const db = makeTestDb(pool);
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  await applyMigrations(db);
  await truncateAll(db);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});
afterAll(async () => {
  await pool.end();
});

async function setup() {
  const rows = {
    user: [],
    session: [],
    account: [],
    verification: [],
    organization: [],
    member: [],
    invitation: [] as Record<string, unknown>[],
  };
  const auth = betterAuth({
    secret: 'invitation-email-test-secret-at-least-32-characters',
    baseURL: 'http://localhost:3800',
    database: memoryAdapter(rows),
    emailAndPassword: { enabled: true },
    plugins: [
      organization({
        async sendInvitationEmail(data) {
          await sendInvitationEmail(
            {
              id: data.id,
              email: data.email,
              role: data.role,
              organizationName: data.organization.name,
              inviterName: data.inviter.user.name,
              inviterEmail: data.inviter.user.email,
            },
            data.invitation,
          );
        },
      }),
    ],
  });
  const signup = await auth.api.signUpEmail({
    body: { name: 'Owner', email: 'owner@example.com', password: 'test-password-115' },
    returnHeaders: true,
  });
  const headers = new Headers({
    cookie: signup.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
  });
  const org = await auth.api.createOrganization({
    body: { name: 'Delivery test', slug: 'delivery-test' },
    headers,
  });
  if (org === null) throw new Error('Organization missing');
  return {
    rows,
    invite: (body: { email: string; resend?: boolean }) =>
      auth.api.createInvitation({
        headers,
        body: { role: 'member', organizationId: org.id, ...body },
        asResponse: true,
      }),
  };
}

test('an invitation whose email fails stays pending and a resend reuses the same link', async () => {
  let sends = 0;
  globalThis.fetch = async () => {
    sends++;
    return Response.json(
      { name: 'validation_error', message: 'API key is invalid' },
      { status: 401 },
    );
  };
  const { rows, invite } = await setup();
  const created = await (await invite({ email: 'failed@example.com' })).json();
  expect(created.emailSent).toBe(false);
  expect(rows.invitation).toHaveLength(1);
  expect(rows.invitation[0]).toMatchObject({ id: created.id, status: 'pending' });
  const resent = await (await invite({ email: 'failed@example.com', resend: true })).json();
  expect(resent.emailSent).toBe(false);
  expect(resent.id).toBe(created.id);
  expect(rows.invitation).toHaveLength(1);
  expect(sends).toBe(2);
});

test('an invitation whose email is accepted reports it as sent', async () => {
  let sent = 0;
  globalThis.fetch = async () => {
    sent++;
    return Response.json({ id: 'email-accepted' });
  };
  const { rows, invite } = await setup();
  const response = await invite({ email: 'sent@example.com' });
  expect(response.status).toBe(200);
  const created = await response.json();
  expect(created.emailSent).toBe(true);
  expect(rows.invitation[0]?.id).toBe(created.id);
  expect(sent).toBe(1);
});
