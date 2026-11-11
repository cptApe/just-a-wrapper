// Which sign-in methods a deployment offers follows its settings, and half a Google setup stops it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCapabilities } from '../../src/lib/capabilities.ts';

test('Google sign-in appears only with the full credential pair; email works without it', () => {
  const local = resolveCapabilities({ NODE_ENV: 'development' });
  assert.deepEqual(local.googleSignIn, { kind: 'off' });
  assert.deepEqual(local.email, { kind: 'console' });
  const hosted = resolveCapabilities({ NODE_ENV: 'production', RESEND_API_KEY: 'test' });
  assert.deepEqual(hosted.email, { kind: 'resend', apiKey: 'test' });
  assert.deepEqual(hosted.googleSignIn, { kind: 'off' });
  assert.deepEqual(
    resolveCapabilities({ GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret' })
      .googleSignIn,
    { kind: 'google', clientId: 'client', clientSecret: 'secret' },
  );
});

test('half a Google setup is refused rather than showing a broken button', () => {
  for (const input of [{ GOOGLE_CLIENT_ID: 'client' }, { GOOGLE_CLIENT_SECRET: 'secret' }]) {
    assert.throws(() => resolveCapabilities(input), { code: 'VALIDATION_FAILED' });
  }
});
