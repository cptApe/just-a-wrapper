// Who may remove a member or change a role. A workspace always keeps an owner, only an owner
// touches owner roles, and members administer nothing. Races between owners run on Postgres in
// tests/integration/workspace-access.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertMemberRemoval } from '../../src/features/workspaces/lib/member-removal.ts';
import { assertMemberRoleChange } from '../../src/features/workspaces/lib/member-role-change.ts';

// [actor, target, next role (null removes), owners, the refusal code or null]
const CASES = [
  ['owner', 'owner', 'admin', 1, 'SOLE_OWNER_BLOCKED'],
  ['owner', 'owner', null, 1, 'SOLE_OWNER_BLOCKED'],
  ['owner', 'owner', 'owner', 1, null],
  ['owner', 'owner', 'member', 2, null],
  ['owner', 'owner', null, 2, null],
  ['owner', 'member', 'owner', 1, null],
  ['owner', 'admin', null, 1, null],
  ['admin', 'member', 'admin', 1, null],
  ['admin', 'member', null, 1, null],
  ['admin', 'member', 'owner', 2, 'FORBIDDEN'],
  ['admin', 'owner', 'admin', 2, 'FORBIDDEN'],
  ['admin', 'owner', null, 2, 'FORBIDDEN'],
  ['member', 'member', 'admin', 1, 'FORBIDDEN'],
  ['member', 'member', null, 1, 'FORBIDDEN'],
];

test('every member change keeps an owner and leaves owner roles to owners', () => {
  for (const [actorRole, targetRole, nextRole, ownerCount, refusal] of CASES) {
    const input = {
      organizationId: 'org-1',
      actorRole,
      target: { id: 'member-1', role: targetRole },
      ownerCount,
    };
    const change = () =>
      nextRole === null
        ? assertMemberRemoval(input)
        : assertMemberRoleChange({ ...input, nextRole });
    const label = `${actorRole} ${nextRole ? `sets ${targetRole} to ${nextRole}` : `removes ${targetRole}`} with ${ownerCount} owner(s)`;
    if (refusal) assert.throws(change, { code: refusal }, label);
    else assert.doesNotThrow(change, label);
  }
});
