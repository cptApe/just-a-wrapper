/** The chat store folds real relay event shapes into the thread a person reads; no mocks. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialState } from '../../src/features/chat/lib/chat-state.ts';
import {
  cancelOptimisticSendEvent,
  optimisticSendEvent,
  reduceEvent,
  workspaceStatusEvent,
} from '../../src/features/chat/lib/chat-store.ts';
import {
  groupTurns,
  selectPendingGates,
  selectQueuedTail,
} from '../../src/features/chat/lib/chat-turns.ts';

const AT = '2026-09-01T10:00:00Z';
const fold = (events, state = createInitialState()) => events.reduce(reduceEvent, state);
const ids = (state) => state.items.map((item) => item.id);
const queued = (state) => selectQueuedTail(state).map((item) => item.id);
const turns = (state) => groupTurns(state.items).map((turn) => turn.items.map((item) => item.id));

const status = (id, value, extra = {}) => ({
  id,
  kind: 'status',
  rawType: `session.status_${value}`,
  status: value,
  ...extra,
});
const user = (id, text, at, extra = {}) => ({
  id,
  kind: 'message',
  rawType: 'user.message',
  role: 'user',
  text,
  ...(at ? { at } : {}),
  ...extra,
});
const reply = (id, text = id) => ({
  id,
  kind: 'message',
  rawType: 'agent.message',
  role: 'assistant',
  text,
  at: AT,
});
const thinking = (id) => ({ id, kind: 'thinking', rawType: 'agent.thinking', at: AT });
// A model request ends with its usage; the next reply belongs to the next queued message.
const requestEnd = (id) => ({
  id,
  kind: 'usage',
  rawType: 'span.model_request_end',
  usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  at: AT,
});
const spanStart = (id) => ({ id, kind: 'span_start', rawType: 'span.model_request_start', at: AT });
const tool = (id, extra = {}) => ({
  id,
  kind: 'tool_use',
  rawType: 'agent.custom_tool_use',
  tool: 'custom',
  name: 'generate_image',
  input: {},
  at: AT,
  ...extra,
});
const toolResult = (id, toolUseId, extra = {}) => ({
  id,
  kind: 'tool_result',
  rawType: 'user.custom_tool_result',
  toolUseId,
  isError: false,
  text: 'done',
  ...extra,
});
const lane = (id, threadId) => ({
  id,
  kind: 'thread',
  rawType: 'session.thread_created',
  threadId,
  detail: { sub: 'created' },
});
const laneStatus = (id, threadId, value) => ({
  id,
  kind: 'thread',
  rawType: `session.thread_status_${value}`,
  threadId,
  detail: { sub: 'status', status: value },
});

test('each reply lands under the queued message it answers, and later messages keep waiting', () => {
  const state = fold([
    status('s1', 'running'),
    user('q1', 'one'),
    user('q2', 'two'),
    user('q3', 'three'),
    thinking('t1'),
    reply('r1'),
    requestEnd('u1'),
    reply('r2'),
  ]);
  assert.deepEqual(ids(state), ['q1', 't1', 'r1', 'q2', 'r2', 'q3']);
  assert.deepEqual(turns(state), [['q1', 't1', 'r1'], ['q2', 'r2'], ['q3']]);
  assert.deepEqual(queued(state), ['q3']);
});

test('a reply already in progress does not swallow messages queued during it', () => {
  const before = fold([
    user('start', 'opening', AT),
    status('s1', 'running'),
    spanStart('span1'),
    user('q1', 'one'),
    user('q2', 'two'),
    reply('current'),
  ]);
  assert.deepEqual(ids(before), ['start', 'current', 'q1', 'q2']);
  assert.deepEqual(queued(before), ['q1', 'q2']);
  const after = fold([status('s1', 'running'), user('q1', 'one'), spanStart('span1'), reply('r1')]);
  assert.deepEqual(ids(after), ['q1', 'r1']);
});

test("a teammate's processed message appears above the queue without unqueueing it", () => {
  const state = fold([status('s1', 'running'), user('q1', 'queued'), user('m2', 'co-writer', AT)]);
  assert.deepEqual(ids(state), ['m2', 'q1']);
  assert.deepEqual(queued(state), ['q1']);
});

test('a re-delivered processed echo unqueues its message, and settling unqueues the rest', () => {
  const running = fold([status('s1', 'running'), user('q1', 'one'), user('q2', 'two')]);
  assert.equal(reduceEvent(running, user('q1', 'one')), running);
  const echoed = reduceEvent(running, user('q1', 'one', AT));
  assert.deepEqual(queued(echoed), ['q2']);
  const settled = reduceEvent(echoed, status('s2', 'idle'));
  assert.deepEqual(ids(settled), ['q1', 'q2']);
  assert.deepEqual(queued(settled), []);
});

test('replaying the same history after a reload rebuilds the same thread', () => {
  const events = [
    user('q1', 'one', AT),
    thinking('t1'),
    reply('r1'),
    user('q2', 'two', AT),
    reply('r2'),
    status('s1', 'idle'),
  ];
  const live = fold(events);
  assert.deepEqual(ids(live), ['q1', 't1', 'r1', 'q2', 'r2']);
  assert.deepEqual(fold(events, live).items, live.items);
  assert.deepEqual(ids(fold(events)), ids(live));
});

test('a sent message shows once, above its tool, before and after its echo arrives', () => {
  const before = fold([
    optimisticSendEvent('local', 'blueprint'),
    status('s1', 'running'),
    tool('image'),
  ]);
  assert.deepEqual(ids(before), ['local', 'image']);
  const after = reduceEvent(before, user('user', 'blueprint', AT));
  assert.deepEqual(ids(after), ['user', 'image']);
  assert.equal(groupTurns(after.items)[0].key, groupTurns(before.items)[0].key);
  assert.equal(reduceEvent(after, user('user', 'blueprint', AT)), after);
  const unprocessed = fold([
    optimisticSendEvent('local', 'blueprint'),
    tool('image'),
    user('user', 'blueprint'),
  ]);
  assert.deepEqual(ids(unprocessed), ['user', 'image']);
});

test('an older message with the same words cannot take the place of a new send', () => {
  const first = fold([user('old', 'same', AT), optimisticSendEvent('local', 'same')]);
  assert.equal(reduceEvent(first, user('old', 'same', AT)), first);
  const after = fold([tool('image'), user('new', 'same', AT)], first);
  assert.deepEqual(ids(after), ['old', 'new', 'image']);
});

test('a failed send disappears, and a late echo after it is not shown twice on retry', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  let state = fold([user('old', 'previous', AT), optimisticSendEvent(id, 'hello')]);
  state = reduceEvent(state, cancelOptimisticSendEvent(id));
  assert.deepEqual(ids(state), ['old']);
  state = reduceEvent(state, user('evt_1', 'hello', undefined, { sendId: id }));
  state = reduceEvent(state, optimisticSendEvent(id, 'hello'));
  assert.equal(
    state.items.filter((item) => item.role === 'user' && item.text === 'hello').length,
    1,
  );
});

test('each echo keeps the attachment previews of its own send, even with the same words', () => {
  const first = [{ id: 'one', name: 'same.png', mimeType: 'image/png', previewUrl: 'blob:one' }];
  const second = [{ id: 'two', name: 'same.png', mimeType: 'image/png', previewUrl: 'blob:two' }];
  const state = fold([
    optimisticSendEvent('one', 'files', { queued: true, attachments: first }),
    optimisticSendEvent('two', 'files', { queued: true, attachments: second }),
    user('server-one', 'files'),
    user('server-two', 'files'),
  ]);
  assert.deepEqual(
    state.items.map((item) => [item.id, item.localId, item.attachments]),
    [
      ['server-one', 'one', first],
      ['server-two', 'two', second],
    ],
  );
});

test('a retrying error row goes when its turn ends; an exhausted one stays', () => {
  const error = (id, retryStatus) => ({
    id,
    kind: 'error',
    rawType: 'session.error',
    text: 'overloaded',
    errorType: 'model_overloaded',
    retryStatus,
  });
  const errors = (state) => state.items.filter((item) => item.type === 'error');
  const end = status('end', 'idle', { stopReason: 'end_turn' });
  assert.equal(errors(fold([status('s1', 'running'), error('e1', 'retrying')])).length, 1);
  assert.equal(errors(fold([status('s1', 'running'), error('e1', 'retrying'), end])).length, 0);
  assert.equal(errors(fold([status('s1', 'running'), error('e2', 'exhausted'), end])).length, 1);
  const paused = fold([
    workspaceStatusEvent('paused_no_credits'),
    status('s1', 'running'),
    error('e1', 'retrying'),
    end,
  ]);
  assert.equal(errors(paused).length, 0);
  assert.equal(paused.status, 'paused_no_credits');
});

test('an older status cannot roll back a newer one, and a terminated task stays terminated', () => {
  let state = fold([
    status('new', 'running', { at: '2026-11-08T00:00:00.1Z' }),
    status('old', 'idle', { at: '2026-11-08T00:00:00.099Z' }),
  ]);
  assert.equal(state.status, 'running');
  state = reduceEvent(state, workspaceStatusEvent('terminated'));
  for (const late of ['running', 'idle', 'paused_no_credits', 'rescheduled'])
    assert.equal(reduceEvent(state, workspaceStatusEvent(late)).status, 'terminated');
  const gate = {
    type: 'tool',
    id: 'gate',
    tool: 'builtin',
    name: 'bash',
    input: {},
    evaluatedPermission: 'ask',
  };
  assert.deepEqual(selectPendingGates({ ...state, items: [gate] }), []);
});

test('a workspace requires-input status keeps the stop reason a parked tool needs', () => {
  const parked = reduceEvent(
    createInitialState(),
    status('idle', 'idle', { stopReason: 'requires_action' }),
  );
  assert.equal(reduceEvent(parked, workspaceStatusEvent('requires_input')), parked);
  const resumed = fold([
    workspaceStatusEvent('paused_no_credits'),
    workspaceStatusEvent('requires_input'),
  ]);
  assert.equal(resumed.status, 'idle');
  assert.equal(resumed.stopReason, 'requires_action');
});

test('a local confirmation never moves the replay cursor, so no server event is skipped', () => {
  const state = createInitialState();
  const next = reduceEvent(state, {
    id: 'local-confirm',
    kind: 'tool_confirmation',
    rawType: 'local.tool_confirmation',
    toolUseId: 'tool',
    result: 'allow',
  });
  assert.equal(next.lastEventId, state.lastEventId);
  assert.equal(next.seen.has('local-confirm'), false);
});

test("a helper's tool calls and results fold into its lane in any arrival order", () => {
  const state = fold([
    tool('early', { threadId: 'helper' }),
    lane('lane', 'helper'),
    toolResult('early-result', 'early', { threadId: 'helper' }),
    tool('later', { threadId: 'helper' }),
    toolResult('later-result', 'later'),
    tool('lost', { threadId: 'no-lane' }),
  ]);
  const helper = state.items.find((item) => item.type === 'subagent');
  const results = helper.entries
    .filter((entry) => entry.sub === 'tool')
    .map((entry) => entry.item.result?.text);
  assert.deepEqual(results, ['done', 'done']);
  assert.equal(state.orphanResults.size, 0);
  assert.deepEqual(
    state.items.map((item) => item.id),
    ['lane', 'lost'],
  );
});

test('a helper waiting on a tool stays running, and a terminated helper ignores late events', () => {
  let state = fold([
    lane('lane', 'helper'),
    laneStatus('idle', 'helper', 'idle'),
    tool('tool', { threadId: 'helper' }),
  ]);
  assert.equal(state.items[0].status, 'running');
  state = reduceEvent(state, toolResult('result', 'tool', { threadId: 'helper' }));
  assert.equal(state.items[0].status, 'idle');
  state = fold(
    [laneStatus('end', 'helper', 'terminated'), tool('late', { threadId: 'helper' })],
    state,
  );
  assert.equal(state.items[0].status, 'terminated');
});

test("a helper's approval gate stays answerable and settles in its lane once confirmed", () => {
  const gated = fold([
    tool('gate', {
      threadId: 'helper',
      rawType: 'agent.tool_use',
      tool: 'builtin',
      name: 'bash',
      evaluatedPermission: 'ask',
    }),
    lane('other', 'unrelated'),
    lane('lane', 'helper'),
  ]);
  assert.deepEqual(
    selectPendingGates(gated).map((item) => item.id),
    ['gate'],
  );
  const confirmed = reduceEvent(gated, {
    id: 'confirmation',
    kind: 'tool_confirmation',
    rawType: 'user.tool_confirmation',
    toolUseId: 'gate',
    result: 'allow',
  });
  const helper = confirmed.items.find((item) => item.threadId === 'helper');
  assert.equal(helper.entries.find((entry) => entry.sub === 'tool').item.confirmation, 'allow');
  assert.deepEqual(selectPendingGates(confirmed), []);
});

test("the session's own thread status pings open no helper lane", () => {
  const state = fold([laneStatus('p1', 'primary', 'running'), laneStatus('p2', 'primary', 'idle')]);
  assert.deepEqual(state.items, []);
  assert.equal(state.seen.size, 2);
});
