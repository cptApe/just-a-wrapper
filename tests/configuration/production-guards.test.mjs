// Settings that would expose or break a production deployment stop the app before it serves a page.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { applyLocalDatabaseProxy } from '../../src/db/local-proxy.ts';
import {
  DEPLOYMENT_SETTINGS,
  resolveDeploymentSetting,
} from '../../src/lib/deployment-settings/registry.ts';
import { adminDeploymentSchema } from '../../src/lib/env-schema.ts';

const required = {
  PATH: process.env.PATH,
  DATABASE_URL: 'postgres://test:test@localhost/test',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
};
const branded = { NEXT_PUBLIC_BRAND_NAME: 'Acme', SUPPORT_EMAIL: 'help@acme.example' };
const production = { NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://example.test' };

/** Loads the real env module in a fresh process, the way `next build` and `next start` do. */
function startWith(environment) {
  return spawnSync(
    process.execPath,
    [
      '--import',
      './scripts/register-aliases.mjs',
      '--input-type=module',
      '-e',
      "await import('./src/lib/env.ts')",
    ],
    { encoding: 'utf8', env: { ...required, ...environment } },
  );
}

test('production refuses to start with the admin console, dev routes, a bad Blob token or the local proxy on', () => {
  for (const [setting, value] of [
    ['NEXT_PUBLIC_ENABLE_ADMIN_ROUTES', 'true'],
    ['NEXT_PUBLIC_ENABLE_DEV_ROUTES', 'true'],
    ['BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw__secret'],
    ['DATABASE_WS_PROXY', 'localhost:54446/v1'],
  ]) {
    const started = startWith({ ...production, ...branded, [setting]: value });
    assert.notEqual(started.status, 0, `${setting}=${value} started`);
    assert.match(started.stderr, new RegExp(setting));
  }
  const healthy = startWith({ ...production, ...branded });
  assert.equal(healthy.status, 0, healthy.stderr);
});

test('production on the placeholder brand refuses to start, naming each value; local and preview runs do not', () => {
  const refused = startWith(production);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /NEXT_PUBLIC_BRAND_NAME is not set/);
  assert.match(refused.stderr, /Set SUPPORT_EMAIL/);
  for (const environment of [
    { ...production, NEXT_PUBLIC_APP_URL: 'http://localhost:3000' },
    { ...production, VERCEL_ENV: 'preview' },
  ]) {
    const started = startWith(environment);
    assert.equal(started.status, 0, started.stderr);
  }
});

test('admin and dev routes are refused on production and allowed on previews and loopback builds', () => {
  for (const flag of ['NEXT_PUBLIC_ENABLE_ADMIN_ROUTES', 'NEXT_PUBLIC_ENABLE_DEV_ROUTES']) {
    for (const [environment, allowed] of [
      [{ VERCEL_ENV: 'production' }, false],
      [{ NODE_ENV: 'production' }, false],
      [{ NODE_ENV: 'production', VERCEL_ENV: 'preview' }, true],
      [{ NODE_ENV: 'development' }, true],
      ...['localhost', '127.0.0.1', '[::1]'].map((host) => [
        { NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: `http://${host}:3000` },
        true,
      ]),
    ]) {
      const result = adminDeploymentSchema.safeParse({ ...environment, [flag]: 'true' });
      assert.equal(result.success, allowed, `${flag} ${JSON.stringify(environment)}`);
      if (!allowed) assert.ok(result.error.issues.some((issue) => issue.path[0] === flag));
      assert.equal(
        adminDeploymentSchema.safeParse({ ...environment, [flag]: 'false' }).success,
        true,
      );
    }
  }
  const malformed = adminDeploymentSchema.safeParse({ NEXT_PUBLIC_APP_URL: 'example.com' });
  assert.ok(malformed.error.issues.some((issue) => issue.path[0] === 'NEXT_PUBLIC_APP_URL'));
});

test('the local database proxy turns TLS off, so only non-production runs may use it', () => {
  const neon = () => ({ wsProxy: 'neon', useSecureWebSocket: true, pipelineConnect: 'password' });
  const proxy = { DATABASE_WS_PROXY: 'localhost:54446/v1' };
  const local = neon();
  assert.equal(applyLocalDatabaseProxy(local, { NODE_ENV: 'development', ...proxy }), true);
  assert.equal(local.wsProxy('ignored-host', 5432), 'localhost:54446/v1');
  assert.equal(local.useSecureWebSocket, false);
  for (const environment of [{}, { DATABASE_WS_PROXY: '  ' }]) {
    const untouched = neon();
    assert.equal(applyLocalDatabaseProxy(untouched, environment), false);
    assert.deepEqual(untouched, neon());
  }
  for (const environment of [{ VERCEL_ENV: 'production' }, production]) {
    const refused = neon();
    assert.throws(
      () => applyLocalDatabaseProxy(refused, { ...environment, ...proxy }),
      /must be unset in production/,
    );
    assert.deepEqual(refused, neon());
  }
  assert.throws(
    () => applyLocalDatabaseProxy(neon(), { DATABASE_WS_PROXY: 'ws://localhost:54446/v1' }),
    /host:port\/path/,
  );
});

test('the billing mode is the stored value, then env, then subscriptions; a bad env value stops the app', () => {
  assert.equal(DEPLOYMENT_SETTINGS.billingMode.fallback, 'subscriptions');
  for (const [stored, envValue, value, source, invalidStored] of [
    ['subscriptions', 'credits_only', 'subscriptions', 'stored', false],
    [null, 'credits_only', 'credits_only', 'env', false],
    [null, undefined, 'subscriptions', 'fallback', false],
    // A stored mode a fork removed is flagged and skipped.
    ['retired', '', 'subscriptions', 'fallback', true],
  ]) {
    assert.deepEqual(resolveDeploymentSetting('billingMode', { stored, envValue }), {
      value,
      source,
      invalidStored,
    });
  }
  assert.throws(
    () => resolveDeploymentSetting('billingMode', { stored: null, envValue: 'plans' }),
    {
      code: 'VALIDATION_FAILED',
      message: 'BILLING_MODE is "plans", which is not a valid billing mode.',
    },
  );
});
