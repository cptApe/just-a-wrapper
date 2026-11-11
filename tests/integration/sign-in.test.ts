// Signing in on a fresh install and the shared sign-in rate limit, through the real Better Auth server.
import { betterAuth } from 'better-auth';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { rateLimit } from '@/db/schema';
import { purgeRateLimits } from '@/features/auth/api/purge-rate-limits';
import { checkSignInEligibility } from '@/features/auth/api/sign-in-eligibility';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { capabilities } from '@/lib/runtime-capabilities';
import { applyMigrations, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(
    actual,
    { GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined, RESEND_API_KEY: undefined },
    { nodeEnv: 'development' },
  ),
);
const pool = makeTestPool();
const database = makeTestDb(pool);
beforeAll(() => applyMigrations(database));
beforeEach(() => truncateAll(database));
afterAll(() => pool.end());

function request(path: string, body: object) {
  return new Request(`http://localhost:3000/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

test('a fresh install with no email or Google keys can still sign in with the code printed to the console', async () => {
  expect(capabilities.googleSignIn.kind).toBe('off');
  expect(capabilities.email.kind).toBe('console');
  const lines: string[] = [];
  const output = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  let sent: Response;
  try {
    sent = await auth.handler(
      request('email-otp/send-verification-otp', {
        email: 'fresh-install@example.com',
        type: 'sign-in',
      }),
    );
  } finally {
    output.mockRestore();
  }
  expect(sent.status).toBe(200);
  const code = lines.join('\n').match(/\b\d{6}\b/)?.[0];
  expect(code).toBeDefined();
  const signedIn = await auth.handler(
    request('sign-in/email-otp', {
      email: 'fresh-install@example.com',
      otp: code,
    }),
  );
  expect(signedIn.status).toBe(200);
  expect(signedIn.headers.get('set-cookie')).toContain('session_token');
});

test('a Google sign-in while Google is off is refused as a client error, not a crash', async () => {
  const response = await auth.handler(
    request('sign-in/social', {
      provider: 'google',
      callbackURL: '/app',
    }),
  );
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(500);
});

test('the sign-in rate limit holds across server instances because the counter lives in Postgres', async () => {
  const options = {
    ...auth.options,
    rateLimit: { ...auth.options.rateLimit, enabled: true, max: 2, window: 60 },
  };
  const first = betterAuth(options);
  const request = () =>
    new Request('http://localhost:3000/api/auth/get-session', {
      headers: { 'x-forwarded-for': '203.0.113.20' },
    });
  expect((await first.handler(request())).status).toBe(200);
  expect((await first.handler(request())).status).toBe(200);
  expect((await database.select().from(rateLimit)).at(0)?.count).toBe(2);
  const second = betterAuth(options);
  expect((await second.handler(request())).status).toBe(429);
});

test('rate-limit cleanup deletes only stale counters and a dry run deletes none', async () => {
  await database.insert(rateLimit).values([
    { id: 'old', key: 'old', count: 2, lastRequest: Date.now() - 2 * 86400000 },
    { id: 'active', key: 'active', count: 2, lastRequest: Date.now() },
  ]);
  expect(await purgeRateLimits({ dryRun: true })).toBe(1);
  expect(await database.select().from(rateLimit)).toHaveLength(2);
  expect(await purgeRateLimits({ dryRun: false })).toBe(1);
  expect((await database.select().from(rateLimit)).map((row) => row.id)).toEqual(['active']);
});

test('while sign-ups are closed a new address is refused a sign-in code and an existing account is not', async () => {
  await seedUser(database, 'known', 'known@example.com');
  Object.assign(env, { AUTH_SIGNUPS_CLOSED: 'true' });
  try {
    expect(await checkSignInEligibility('newcomer@example.com')).toEqual({ status: 'no-account' });
    expect(await checkSignInEligibility('known@example.com')).toEqual({ status: 'eligible' });
  } finally {
    Object.assign(env, { AUTH_SIGNUPS_CLOSED: 'false' });
  }
  expect(await checkSignInEligibility('newcomer@example.com')).toEqual({ status: 'eligible' });
});
