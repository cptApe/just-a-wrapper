// Workspace, account and invitation lifecycles: rows move only forward, deleted data is purged
// after exactly thirty days, and upstream session deletion finishes what it can and defers the rest.
// Purge selection and guarded deletes run on Postgres in tests/integration/retention-purge.test.ts.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import '../support/env.mjs';
import { accountLifecycleMachine } from '../../src/features/auth/lib/account-lifecycle-machine.ts';
import { invitationMachine } from '../../src/features/workspaces/lib/invitation-machine.ts';
import { provisioningMachine } from '../../src/features/workspaces/lib/provisioning-machine.ts';
import { purgeCutoff } from '../../src/features/workspaces/lib/purge-policy.ts';
import { workspaceLifecycleMachine } from '../../src/features/workspaces/lib/workspace-lifecycle-machine.ts';

const Anthropic = (await import('@anthropic-ai/sdk')).default;
const { deleteSessionsUpstream } = await import(
  '../../src/features/workspaces/api/delete-sessions-upstream.ts'
);

for (const [name, machine, allowed] of [
  [
    'workspace',
    workspaceLifecycleMachine,
    ['live:deleting', 'deleting:deleted', 'deleted:purging', 'purging:purging'],
  ],
  ['account', accountLifecycleMachine, ['live:deleted', 'deleted:anonymized']],
  ['invitation', invitationMachine, ['pending:accepted', 'pending:rejected', 'pending:canceled']],
  ['provisioning', provisioningMachine, ['pending:ready', 'ready:pending']],
]) {
  test(`a ${name} row makes only its allowed moves and is refused the rest`, () => {
    for (const from of machine.states)
      for (const to of machine.states) {
        const expected = allowed.includes(`${from}:${to}`);
        assert.equal(machine.can(from, to), expected, `${from} -> ${to}`);
        assert.equal(machine.sourcesOf(to).includes(from), expected, `${from} -> ${to}`);
        if (!expected) assert.throws(() => machine.assertCan(from, to), { code: 'CONFLICT' });
      }
  });
}

test('deleted data is purged exactly thirty elapsed days after the sweep time', () => {
  assert.equal(
    purgeCutoff(new Date('2026-11-08T12:00:00.000Z')).toISOString(),
    '2026-10-09T12:00:00.000Z',
  );
});

test('upstream deletion counts a 404 as gone, keeps going past a failure and defers once out of time', async () => {
  const calls = [];
  const client = {
    beta: {
      sessions: {
        async delete(sessionId) {
          calls.push(sessionId);
          if (sessionId === 'gone')
            throw new Anthropic.APIError(404, {}, 'not found', new Headers());
          if (sessionId === 'fails')
            throw new Anthropic.APIError(500, {}, 'upstream', new Headers());
        },
      },
    },
  };
  const reported = mock.method(console, 'error', () => {});
  try {
    assert.deepEqual(
      await deleteSessionsUpstream(client, ['gone', 'fails', 'live'], Date.now() + 60_000),
      { deleted: 1, alreadyGone: 1, failed: 1, deferred: 0, completedIds: ['gone', 'live'] },
    );
    assert.equal(reported.mock.calls[0].arguments[1].sessionId, 'fails');
  } finally {
    reported.mock.restore();
  }
  calls.length = 0;
  assert.deepEqual(await deleteSessionsUpstream(client, ['one', 'two'], Date.now() - 1), {
    deleted: 0,
    alreadyGone: 0,
    failed: 0,
    deferred: 2,
    completedIds: [],
  });
  assert.deepEqual(calls, []);
});
