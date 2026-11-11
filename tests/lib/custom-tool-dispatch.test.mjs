// The browser runs a custom tool call only while the session waits for it, once, and gives up
// after a bounded retry. A second dispatch repeats a paid or visible action.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APIError } from '@anthropic-ai/sdk';
import {
  getAlreadyResolvedCustomToolDispatchId,
  selectActiveAutoDispatchToolUseIds,
  selectCustomToolDispatchCalls,
} from '../../src/features/chat/lib/custom-tool-dispatch-retry.ts';
import { toolRequestReducer } from '../../src/features/chat/lib/tool-request-machine.ts';
import { isAwaitingToolResultError } from '../../src/features/sessions/lib/awaiting-tool-result-error.ts';
import { AppError } from '../../src/lib/errors.ts';

const primary = { type: 'tool', id: 'primary', name: 'custom', tool: 'custom', input: {} };
const helper = { ...primary, id: 'helper', threadId: 'child' };

test('only a session that waits on a tool result dispatches, and only its permitted calls', () => {
  for (const [status, stopReason, count] of [
    ['running', null, 1],
    ['idle', 'end_turn', 1],
    ['idle', 'requires_action', 2],
    ['paused_no_credits', null, 0],
    ['terminated', null, 0],
  ]) {
    const calls = selectCustomToolDispatchCalls(
      { status, stopReason, items: [primary, helper] },
      true,
      new Map(),
      0,
    );
    assert.equal(calls.length, count, `${status}/${stopReason}`);
  }
});

test('a replayed, posted, running, exhausted or still-waiting call is never sent again', () => {
  const state = { status: 'idle', stopReason: 'requires_action', items: [primary] };
  assert.deepEqual(selectCustomToolDispatchCalls(state, false, new Map(), 0), []);
  for (const request of [
    { kind: 'posted' },
    { kind: 'exhausted', failures: 3 },
    { kind: 'dispatching', failures: 0, attempt: Symbol() },
    { kind: 'waiting', failures: 1, retryAt: 500 },
  ]) {
    assert.deepEqual(
      selectCustomToolDispatchCalls(state, true, new Map([['primary', request]]), 0),
      [],
    );
  }
  const due = new Map([['primary', { kind: 'waiting', failures: 1, retryAt: 500 }]]);
  assert.equal(selectCustomToolDispatchCalls(state, true, due, 500).length, 1);
  const posted = new Map([['primary', { kind: 'posted' }]]);
  assert.equal(selectActiveAutoDispatchToolUseIds([primary], true, posted).size, 0);
});

test('failures exhaust after three attempts without retrying a peer that succeeded', () => {
  let state = new Map();
  for (let now = 0; now < 1500; now += 500) {
    const attempt = Symbol();
    state = toolRequestReducer(state, { type: 'dispatch', ids: ['retry', 'done'], attempt, now });
    state = toolRequestReducer(state, { type: 'posted', id: 'done', attempt });
    state = toolRequestReducer(state, { type: 'failed', ids: ['retry'], attempt, now });
  }
  assert.equal(state.get('retry').kind, 'exhausted');
  assert.equal(state.get('done').kind, 'posted');
});

test('a slow tool polls without using up failures until its execution deadline', () => {
  let state = new Map();
  for (const now of [0, 5000, 300000, 310000]) {
    const attempt = Symbol();
    state = toolRequestReducer(state, { type: 'dispatch', ids: ['slow'], attempt, now });
    state = toolRequestReducer(state, { type: 'progress', id: 'slow', attempt, now });
    assert.equal(state.get('slow').failures, 0);
    assert.equal(state.get('slow').kind, now === 310000 ? 'exhausted' : 'waiting');
  }
  const attempt = Symbol();
  state = new Map([
    ['slow', { kind: 'waiting', failures: 0, retryAt: 5000, progressDeadline: 310000 }],
  ]);
  state = toolRequestReducer(state, { type: 'dispatch', ids: ['slow'], attempt, now: 5000 });
  state = toolRequestReducer(state, { type: 'posted', id: 'slow', attempt });
  assert.equal(
    toolRequestReducer(state, { type: 'progress', id: 'slow', attempt, now: 6000 }).get('slow')
      .kind,
    'posted',
  );
});

test('only the server saying a call is already resolved, or the session waiting on a result, is recognised', () => {
  assert.equal(getAlreadyResolvedCustomToolDispatchId(new Error('resolved')), null);
  assert.equal(
    getAlreadyResolvedCustomToolDispatchId(
      new AppError('API_REQUEST_FAILED', 'resolved', {
        status: 400,
        serverCode: 'CUSTOM_TOOL_ALREADY_RESOLVED',
        serverToolUseId: 'primary',
      }),
    ),
    'primary',
  );
  const providerError = (message) =>
    APIError.generate(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message } },
      message,
      new Headers(),
    );
  assert.equal(
    isAwaitingToolResultError(
      providerError(
        'waiting on responses to events [sevt_1]; only `user.custom_tool_result` may be sent',
      ),
    ),
    true,
  );
  assert.equal(isAwaitingToolResultError(providerError('invalid input')), false);
  assert.equal(isAwaitingToolResultError(new Error('waiting on responses to events')), false);
});
