/** Tools that fetch a URL for the agent must never reach our own network or a cloud metadata
 * endpoint: not directly, not through DNS, not through a redirect. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { receiveRedirect } from '../../src/features/tools/lib/redirect-machine.ts';
import { assertPublicTarget, blockedTargetReason } from '../../src/features/tools/lib/url-guard.ts';
import { resolveUrlAudio } from '../../src/features/tools/lib/voice-download.ts';

const isInvalidInput = (error) => error.code === 'TOOL_INPUT_INVALID';

test('a private, loopback, link-local or non-web address is refused', () => {
  for (const url of [
    'file:///etc/passwd',
    'ftp://example.com',
    'data:text/html,x',
    'not a url',
    'http://localhost:8080/admin',
    'http://api.localhost/',
    'http://127.9.9.9:5000',
    'http://0.0.0.0',
    'http://10.0.0.5',
    'http://172.16.0.1',
    'http://172.31.255.255',
    'http://192.168.1.1',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]:3000',
    'http://[fe80::1]',
    'http://[fc00::1]',
    'http://[fd12:3456::1]',
    'http://[::ffff:127.0.0.1]',
  ]) {
    assert.notEqual(blockedTargetReason(url), null, url);
  }
});

test('ordinary public sites are allowed, including names and ranges that look private', () => {
  for (const url of [
    'https://example.com',
    'https://sub.domain.co.uk:8443/page',
    'https://8.8.8.8/',
    'https://fda.gov',
    'https://fcbarcelona.com',
    'http://172.15.0.1',
    'http://172.32.0.1',
    'http://192.169.0.1',
  ]) {
    assert.equal(blockedTargetReason(url), null, url);
  }
});

test('a public name whose DNS answer is a private address is refused', async () => {
  for (const address of ['127.0.0.1', '10.0.0.2', '100.64.0.1', '169.254.169.254', '::1']) {
    await assert.rejects(
      assertPublicTarget('https://audio.example/clip.mp3', async () => [
        { address, family: address.includes(':') ? 6 : 4 },
      ]),
      isInvalidInput,
      address,
    );
  }
});

test('a redirect to a private address is refused before it is fetched', async (t) => {
  const fetched = [];
  t.mock.method(globalThis, 'fetch', async (target, init) => {
    fetched.push({ url: target.toString(), redirect: init.redirect });
    return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/x.mp3' } });
  });
  await assert.rejects(resolveUrlAudio('https://93.184.216.34/start'), isInvalidInput);
  assert.deepEqual(fetched, [{ url: 'https://93.184.216.34/start', redirect: 'manual' }]);
});

test('a redirect chain stops at its limit', () => {
  const initial = { kind: 'requesting', url: new URL('https://example.org'), redirects: 0 };
  const redirect = new Response('', { status: 302, headers: { location: '/next' } });
  const next = receiveRedirect(initial, redirect, 1);
  assert.equal(next.url.pathname, '/next');
  assert.throws(() => receiveRedirect(next, redirect, 1));
});
