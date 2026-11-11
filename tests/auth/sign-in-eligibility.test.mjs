// With sign-ups closed, only an existing account gets a sign-in code, and the public check is
// throttled per address. The user lookup and env are replaced; open sign-in runs on Postgres in
// tests/integration/sign-in.test.ts.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { emailInput } from '../../src/features/auth/lib/email-input.ts';
import { createEmailRateLimit } from '../../src/features/auth/lib/email-rate-limit.ts';
import { AppError } from '../../src/lib/errors.ts';
import { loadTsx } from '../support/load-tsx.mjs';

const require = createRequire(import.meta.url);

function setup({ closed = 'true', exists = false, fail = false } = {}) {
  let reads = 0;
  const check = loadTsx('src/features/auth/api/sign-in-eligibility.ts', (name) => {
    if (name === '@/db')
      return {
        db: {
          select: () => {
            reads++;
            return {
              from: () => ({
                where: () => ({
                  limit: async () => {
                    if (fail) throw new Error('database offline');
                    return exists ? [{ id: 'known' }] : [];
                  },
                }),
              }),
            };
          },
        },
      };
    if (name === '@/db/schema') return { user: { id: 'id', email: 'email' } };
    if (name === '@/lib/env') return { env: { AUTH_SIGNUPS_CLOSED: closed } };
    if (name === '@/lib/errors') return { AppError };
    if (name === '@/lib/request-context')
      return {
        withRequestContext: (ctx, fn) => {
          assert.equal(ctx.route, 'sign-in-eligibility');
          return fn();
        },
      };
    if (name === '../lib/email-input') return { emailInput };
    if (name === '../lib/email-rate-limit') return { createEmailRateLimit };
    return require(name);
  }).checkSignInEligibility;
  return { check, reads: () => reads };
}

test('open sign-ups admit any well-formed email without a lookup; closed ones only an existing account', async () => {
  for (const closed of ['', 'false']) {
    const open = setup({ closed });
    assert.deepEqual(await open.check('New@Example.com'), { status: 'eligible' });
    assert.equal(open.reads(), 0);
  }
  assert.deepEqual(await setup().check('new@example.com'), { status: 'no-account' });
  assert.deepEqual(await setup({ exists: true }).check('known@example.com'), {
    status: 'eligible',
  });
  const malformed = setup();
  for (const value of ['', 'bad', null, {}, 123]) {
    assert.deepEqual(await malformed.check(value), { status: 'invalid' });
  }
  assert.equal(malformed.reads(), 0);
});

test('an address gets five checks a minute however it is cased or padded', async () => {
  const s = setup();
  for (let i = 0; i < 5; i++) await s.check(' Test@Example.com ');
  assert.deepEqual(await s.check('test@example.com'), { status: 'rate-limited' });
  assert.equal(s.reads(), 5);
  const allow = createEmailRateLimit();
  for (let i = 0; i < 5; i++) allow('test@example.com', 0);
  assert.equal(allow('test@example.com', 59_999), false);
  assert.equal(allow('test@example.com', 60_000), true);
});

test('a database outage fails the check loudly instead of admitting or refusing the address', async () => {
  await assert.rejects(
    setup({ fail: true }).check('test@example.com'),
    (error) => error.code === 'DATABASE_UNAVAILABLE' && error.cause.message === 'database offline',
  );
});
