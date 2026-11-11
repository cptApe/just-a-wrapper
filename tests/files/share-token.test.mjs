import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateShareToken, isShareLive, shareState } from '../../src/lib/share-token.ts';

// The predicate behind /share/[token]. Resolution on real rows lives in tests/integration/files-sharing.test.ts.
const NOW = new Date('2026-06-11T12:00:00Z');
const past = new Date('2026-06-10T12:00:00Z');
const future = new Date('2026-06-12T12:00:00Z');

test('an expired or revoked link never opens, even at the exact expiry or with a skewed clock', () => {
  for (const [share, state] of [
    [{ expiresAt: null, revokedAt: null }, 'live'],
    [{ expiresAt: future, revokedAt: null }, 'live'],
    [{ expiresAt: past, revokedAt: null }, 'expired'],
    [{ expiresAt: NOW, revokedAt: null }, 'expired'],
    [{ expiresAt: null, revokedAt: past }, 'revoked'],
    [{ expiresAt: past, revokedAt: past }, 'revoked'],
    [{ expiresAt: null, revokedAt: future }, 'revoked'],
  ]) {
    assert.equal(shareState(share, NOW), state, JSON.stringify(share));
    assert.equal(isShareLive(share, NOW), state === 'live');
  }
});

test('share tokens are long, url-safe and not repeated', () => {
  const a = generateShareToken();
  assert.notEqual(a, generateShareToken());
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.ok(a.length >= 32);
});
