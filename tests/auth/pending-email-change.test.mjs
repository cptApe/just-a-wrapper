// A pending email change is remembered in this browser for its own account only, so another
// person signing in on the same browser never sees someone else's new address.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { loadTsx } from '../support/load-tsx.mjs';

const require = createRequire(import.meta.url);
const marker = loadTsx('src/features/auth/lib/pending-email-change.ts', (name) =>
  name === '@/lib/errors' ? require('../../src/lib/errors.ts') : require(name),
);

test('a pending email never shows for another account, a verified address or after it expires', (context) => {
  const storage = new Map();
  const previous = globalThis.window;
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  });
  context.after(() => {
    globalThis.window = previous;
  });
  marker.savePendingEmailChange('user-1', 'old@example.com', 'new@example.com');
  assert.equal(marker.readPendingEmailChange('user-1', 'old@example.com'), 'new@example.com');
  assert.equal(marker.readPendingEmailChange('user-2', 'old@example.com'), null);
  assert.equal(marker.readPendingEmailChange('user-1', 'new@example.com'), null);
  marker.clearVerifiedEmailChange('user-1', 'new@example.com');
  assert.equal(storage.size, 0);
  marker.savePendingEmailChange('user-1', 'old@example.com', 'new@example.com');
  const expiredAt = Date.now() + 3_600_001;
  context.mock.method(Date, 'now', () => expiredAt);
  assert.equal(marker.readPendingEmailChange('user-1', 'old@example.com'), null);
});
