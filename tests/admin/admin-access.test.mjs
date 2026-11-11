// Who reaches the operator console: off without the flag, never in production, open on a loopback
// app, sign-in everywhere else. The real layout, markdown route and settings writes use the gate;
// only Next's notFound/redirect, the session read and env are replaced.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as envSchema from '../../src/lib/env-schema.ts';
import * as errors from '../../src/lib/errors.ts';
import { loadTsx } from '../support/load-tsx.mjs';

const on = { NEXT_PUBLIC_ENABLE_ADMIN_ROUTES: 'true' };

test('the console is off without the flag and in production, open on loopback, sign-in elsewhere', () => {
  for (const [environment, access] of [
    [{ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }, 'disabled'],
    [
      { NEXT_PUBLIC_ENABLE_ADMIN_ROUTES: 'false', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' },
      'disabled',
    ],
    [{ ...on, VERCEL_ENV: 'production' }, 'disabled'],
    [{ ...on, NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://app.example.com' }, 'disabled'],
    [
      {
        ...on,
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
        NEXT_PUBLIC_APP_URL: 'https://p.vercel.app',
      },
      'signed_in',
    ],
    // A preview pointing its app URL at localhost is still a preview.
    [{ ...on, VERCEL_ENV: 'preview', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }, 'signed_in'],
    [
      { ...on, NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'https://dev.example.com' },
      'signed_in',
    ],
    [{ ...on, NODE_ENV: 'development' }, 'signed_in'],
    [{ ...on, NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000' }, 'open'],
    [{ ...on, NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }, 'open'],
  ]) {
    assert.equal(envSchema.adminConsoleAccess(environment), access, JSON.stringify(environment));
  }
});

const root = new URL('../../src/app/(admin)/', import.meta.url).pathname;

function gateWith({ env, session, processEnv = {} }) {
  const saved = { NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV };
  Object.assign(process.env, processEnv);
  if (processEnv.VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
  const access = loadTsx(`${root}admin-access.ts`, (name) => {
    if (name === 'server-only') return {};
    if (name === 'next/navigation')
      return {
        notFound: () => {
          throw new Error('NOT_FOUND');
        },
        redirect: (url) => {
          throw new Error(`REDIRECT ${url}`);
        },
      };
    if (name === '@/features/auth/lib/login-redirect')
      return { loginRedirectUrl: async () => '/login?returnTo=%2Fadmin' };
    if (name === '@/lib/env') return { env };
    if (name === '@/lib/env-schema') return envSchema;
    if (name === '@/lib/errors') return errors;
    if (name === '@/lib/request-session') return { getRequestSession: async () => session };
    throw new Error(`Unexpected dependency ${name}`);
  });
  const layout = loadTsx(`${root}layout.tsx`, (name) => {
    if (name === '@/lib/brand/identity') return { brand: { name: 'Test' } };
    if (name === './admin-access') return access;
    if (name === 'react/jsx-runtime') return { jsx: () => null, Fragment: 'fragment' };
    throw new Error(`Unexpected layout dependency ${name}`);
  }).default;
  const route = loadTsx(`${root}admin-markdown/[slug]/route.ts`, (name) => {
    if (name === 'next/navigation')
      return {
        notFound: () => {
          throw new Error('NOT_FOUND');
        },
      };
    if (name === '@/features/admin')
      return {
        adminPageMeta: () => ({}),
        adminSourcesMarkdown: () => '',
        isAdminPageSlug: () => true,
      };
    if (name === '@/features/admin/server')
      return { ADMIN_MD_SOURCES: { brand: async () => '# Brand' } };
    if (name === '@/lib/request-context') return { withRequestContext: (_, run) => run() };
    if (name === '../../admin-access') return access;
    throw new Error(`Unexpected route dependency ${name}`);
  }).GET;
  return {
    page: () => layout({ children: null }),
    markdown: () =>
      route(new Request('https://x/'), { params: Promise.resolve({ slug: 'brand' }) }),
    actor: () => access.requireAdminActor(),
    async run(check) {
      try {
        await check(this);
      } finally {
        for (const [key, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    },
  };
}

const preview = {
  env: { ...on, NEXT_PUBLIC_APP_URL: 'https://preview.example.app' },
  processEnv: { NODE_ENV: 'production', VERCEL_ENV: 'preview' },
};
const local = {
  env: { ...on, NEXT_PUBLIC_APP_URL: 'http://localhost:3000' },
  processEnv: { NODE_ENV: 'development' },
};
const off = {
  env: { NEXT_PUBLIC_ENABLE_ADMIN_ROUTES: 'false', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' },
};

test('a signed-out visitor on a preview is sent to sign in by every page, route and settings write', () =>
  gateWith({ ...preview, session: null }).run(async (gate) => {
    await assert.rejects(gate.page(), /REDIRECT \/login/);
    await assert.rejects(gate.markdown(), /REDIRECT/);
    await assert.rejects(gate.actor(), { code: 'FORBIDDEN' });
  }));

test('a signed-in user on a preview reaches the console and is named on every settings write', () =>
  gateWith({ ...preview, session: { user: { id: 'u' } } }).run(async (gate) => {
    await gate.page();
    assert.equal((await gate.markdown()).status, 200);
    assert.deepEqual(await gate.actor(), { userId: 'u' });
  }));

test('with the flag off the console is not found, even for a signed-in user', () =>
  gateWith({ ...off, session: { user: { id: 'u' } } }).run(async (gate) => {
    await assert.rejects(gate.page(), /NOT_FOUND/);
    await assert.rejects(gate.markdown(), /NOT_FOUND/);
    await assert.rejects(gate.actor(), { code: 'FORBIDDEN' });
  }));

test('a loopback console stays open without a session', () =>
  gateWith({ ...local, session: null }).run(async (gate) => {
    await gate.page();
    assert.deepEqual(await gate.actor(), { userId: null });
  }));
