// Who sees whose usage. The Usage page loads by-member data and scopes its reads from this decision.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveUsageGating } from '../../src/features/billing/lib/usage-gating.ts';

test('a member sees only their own usage, never another member or the workspace balance', () => {
  const all = {
    effectiveUserId: null,
    requestedMember: null,
    showRemaining: true,
    showByMember: true,
  };
  const own = {
    effectiveUserId: 'me',
    requestedMember: null,
    showRemaining: false,
    showByMember: false,
  };
  for (const [isAdmin, requestedMember, expected] of [
    [true, null, all],
    [
      true,
      '  other  ',
      {
        effectiveUserId: 'other',
        requestedMember: 'other',
        showRemaining: false,
        showByMember: true,
      },
    ],
    [false, 'someone-else', own],
    [false, null, own],
  ]) {
    const gating = resolveUsageGating({ isAdmin, ownUserId: 'me', requestedMember });
    for (const [key, value] of Object.entries(expected))
      assert.equal(
        gating[key],
        value,
        `${isAdmin ? 'admin' : 'member'} ${requestedMember}: ${key}`,
      );
  }
});
