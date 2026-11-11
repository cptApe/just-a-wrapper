// After sign-in a person lands back on this app only: the return path is a same-origin path, and
// the login page sends an already signed-in visitor there before rendering.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {
  loginUrlWithReturnTo,
  RETURN_TO_PARAM,
  safeReturnTo,
} from '../../src/features/auth/lib/return-to.ts';
import { loadTsx } from '../support/load-tsx.mjs';

const require = createRequire(import.meta.url);

test('only a same-origin path survives as a return destination', () => {
  for (const path of ['/app/tools', '/app/tools?tab=built-in', '/knowledge/memory?q=a%20b'])
    assert.equal(safeReturnTo(path), path);
  for (const path of [
    '//evil.com',
    '//evil.com/path',
    'https://evil.com',
    'javascript:alert(1)',
    'mailto:a@b.com',
    // Browsers fold a backslash into a slash.
    '/\\',
    '/\\evil.com',
    '/app\\..\\x',
    '/foo\n//evil.com',
    '/foo\t/x',
    '/foo bar',
    '\t//evil.com',
    'app/tools',
    'evil.com',
    '',
    null,
    undefined,
  ])
    assert.equal(safeReturnTo(path), null, JSON.stringify(path));
  assert.equal(
    loginUrlWithReturnTo('/app/tools?tab=built-in'),
    `/login?${RETURN_TO_PARAM}=${encodeURIComponent('/app/tools?tab=built-in')}`,
  );
  assert.equal(loginUrlWithReturnTo('https://evil.com'), '/login');
});

test('a signed-in visitor on the login page is redirected to a safe destination before it renders', async () => {
  const page = loadTsx('src/app/(auth)/login/page.tsx', (name) => {
    if (name === '@/lib/brand/identity') return { brand: { name: 'Test' } };
    if (name === 'next/navigation')
      return {
        redirect: (path) => {
          throw { redirect: path };
        },
      };
    if (name === '@/lib/request-session')
      return { getRequestSession: async () => ({ user: { id: 'viewer' } }) };
    if (name === '@/features/auth/lib/return-to') return { safeReturnTo };
    if (name === '@/lib/runtime-capabilities')
      return { capabilities: { email: { kind: 'console' }, googleSignIn: { kind: 'off' } } };
    if (name === '@/features/auth') return { AuthForm: 'auth-form' };
    if (name === '@/components/brand/logo') return { LOGO_MARK_PATH: 'M0 0' };
    return require(name);
  }).default;
  for (const [params, destination] of [
    [{}, '/app'],
    [{ returnTo: '/app/settings' }, '/app/settings'],
    [{ returnTo: 'https://evil.example' }, '/app'],
    [{ returnTo: '//evil.example' }, '/app'],
    [{ next: '/app/settings' }, '/app/settings'],
    [{ returnTo: '/app/tools', next: '/app/settings' }, '/app/tools'],
  ]) {
    await assert.rejects(
      page({ searchParams: Promise.resolve(params) }),
      (error) => error.redirect === destination,
      JSON.stringify(params),
    );
  }
});
