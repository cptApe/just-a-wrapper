// Session lifecycles: every allowed and refused move, plus the client reducers that guard lost or stale work.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  connectionReducer,
  initialConnection,
} from '../../src/features/chat/lib/connection-machine.ts';
import { reduceBackgroundWork } from '../../src/features/sessions/lib/background-work-machine.ts';
import { relayConnectionMachine } from '../../src/features/sessions/lib/relay-connection-machine.ts';
import {
  publicSessionStatus,
  sessionMachine,
} from '../../src/features/sessions/lib/session-machine.ts';
import { sessionSendMachine } from '../../src/features/sessions/lib/session-send-machine.ts';

function assertMoves(machine, edges) {
  assert.deepEqual([...machine.states].sort(), Object.keys(edges).sort());
  for (const from of machine.states)
    for (const to of machine.states) {
      const allowed = edges[from].includes(to);
      assert.equal(machine.can(from, to), allowed, `${from} -> ${to}`);
      assert.equal(machine.sourcesOf(to).includes(from), allowed, `${from} -> ${to}`);
      if (allowed) assert.doesNotThrow(() => machine.assertCan(from, to));
      else assert.throws(() => machine.assertCan(from, to), `${from} -> ${to}`);
    }
}

const live = ['running', 'idle', 'rescheduling', 'requires_input', 'pausing', 'terminated'];

test('a session moves only along its lifecycle: termination is final and replay cannot lift a credit pause', () => {
  assertMoves(sessionMachine, {
    creating: ['awaiting_opening', 'opening', 'creation_cleanup', 'terminated'],
    creation_cleanup: ['terminated'],
    awaiting_opening: ['opening', 'creation_cleanup', 'terminated'],
    opening: ['creation_cleanup', 'awaiting_opening', ...live],
    idle: live,
    running: live,
    rescheduling: live,
    requires_input: live,
    pausing: ['pausing', 'paused_no_credits', 'terminated'],
    paused_no_credits: ['resuming', 'terminated'],
    resuming: ['paused_no_credits', 'running', 'pausing', 'terminated'],
    terminated: [],
  });
  assert.equal(publicSessionStatus('resuming'), 'paused_no_credits');
});

test('a delivered send can never be sent again, and an unconfirmed one settles only after a history check', () => {
  assertMoves(sessionSendMachine, {
    sending: ['delivered', 'error', 'unconfirmed'],
    error: ['sending', 'delivered'],
    unconfirmed: ['delivered', 'error'],
    delivered: [],
  });
});

test('a relay connection replays history before it tails and never reopens once closed', () => {
  assertMoves(relayConnectionMachine, {
    connecting: ['replaying', 'closed'],
    replaying: ['tailing', 'closed'],
    tailing: ['closed'],
    closed: [],
  });
});

test('a chat that lost access stops reconnecting for good, while a relay failure allows one explicit retry', () => {
  const lost = connectionReducer(initialConnection(0), {
    type: 'error',
    epoch: 0,
    error: { code: 'ACCESS_LOST', message: 'denied' },
  });
  assert.equal(lost.status, 'access_lost');
  for (const action of [
    { type: 'remint', now: 999999 },
    { type: 'tick', now: 999999, running: true },
    { type: 'open', epoch: 0, now: 999999 },
  ])
    assert.equal(connectionReducer(lost, action), lost);

  const failed = connectionReducer(initialConnection(0), {
    type: 'error',
    epoch: 0,
    error: { code: 'RELAY_FAILED', message: 'failed' },
  });
  assert.equal(connectionReducer(failed, { type: 'tick', now: 999999, running: true }), failed);
  const retry = connectionReducer(failed, { type: 'remint', now: 999999 });
  assert.equal(retry.status, 'connecting');
  assert.equal(retry.replay.kind, 'replaying');
  assert.equal(
    connectionReducer(retry, { type: 'error', epoch: 0, error: { code: 'OLD', message: 'old' } }),
    retry,
    'a callback from the old socket cannot fail the new one',
  );
});

test('work queued after close reopens draining instead of being dropped', () => {
  let state = reduceBackgroundWork({ phase: 'open' }, 'close');
  state = reduceBackgroundWork(state, 'drain');
  assert.deepEqual(reduceBackgroundWork(state, 'enqueue'), { phase: 'draining' });
});
