/** Custom tools run once, settle with the saved result in any replay order, and never count progress as approval. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as zod from 'zod';
import { createInitialState } from '../../src/features/chat/lib/chat-state.ts';
import { reduceEvent } from '../../src/features/chat/lib/chat-store.ts';
import * as retry from '../../src/features/chat/lib/custom-tool-dispatch-retry.ts';
import { createReducerStore } from '../../src/features/chat/lib/reducer-store.ts';
import { safeParseRelayFrame } from '../../src/features/chat/lib/relay-frame-schema.ts';
import { toolStatusOf } from '../../src/features/chat/lib/tool-display-activity.ts';
import * as toolMachine from '../../src/features/chat/lib/tool-request-machine.ts';
import { AppError } from '../../src/lib/errors.ts';
import { loadTsx } from '../support/load-tsx.mjs';
import { assertRefusedMove } from '../support/refused-move.mjs';

const { toolRequestReducer } = toolMachine;
// Relay frames captured from a real image generation, replayed through the wire validator.
const events = JSON.parse(
  readFileSync(new URL('./fixtures/custom-tool-image-replay.json', import.meta.url), 'utf8'),
).map((frame) => {
  const parsed = safeParseRelayFrame(frame);
  assert.equal(parsed.ok, true);
  return parsed.frame.event;
});
const call = events.find((event) => event.kind === 'tool_use');
const result = events.find((event) => event.kind === 'tool_result');
const end = events.findLast((event) => event.stopReason === 'end_turn');

test('a generated image settles with its saved URL however the replay orders the events', () => {
  for (const sequence of [
    events,
    [...events.filter((event) => event !== result), result],
    [result, call, end],
  ]) {
    const state = sequence.reduce(reduceEvent, createInitialState());
    const item = state.items.find((entry) => entry.type === 'tool');
    assert.equal(toolStatusOf(item, { live: false }), 'done');
    assert.equal(JSON.parse(item.result.text).image.url, JSON.parse(result.text).image.url);
    assert.equal(state.orphanResults.size, 0);
    assert.deepEqual(sequence.reduce(reduceEvent, state).items, state.items);
  }
});

async function dispatchWith(outcome, decision = null) {
  let replays = 0;
  const errors = [];
  let cached = decision ? [{ toolUseId: call.id }] : [];
  const dependencies = {
    zod,
    sonner: { toast: { error: (error) => errors.push(error) } },
    '@/lib/fetch-json': {
      fetchJson: async () => {
        if (outcome instanceof Error) throw outcome;
        return { outcomes: outcome };
      },
    },
    '@/lib/observability-client': { captureException: (error) => errors.push(error) },
    '../lib/custom-tool-dispatch-retry': retry,
    '../lib/tool-request-machine': toolMachine,
  };
  const requests = loadTsx('src/features/chat/api/tool-decision-requests.ts', (name) => {
    assert.ok(name in dependencies, `unmocked dependency ${name}`);
    return dependencies[name];
  });
  const store = createReducerStore(new Map(), toolRequestReducer);
  const scope = {
    sessionId: 'session',
    store,
    queryClient: {
      invalidateQueries: async () => {},
      setQueryData(_key, update) {
        cached = update(cached);
      },
    },
    pendingKey: ['pending'],
    reattach: () => {
      replays += 1;
    },
  };
  if (decision) {
    store.dispatch({ type: 'pending', id: call.id });
    await requests.answerCustomTool(scope, call.id, decision);
    return { replays, errors, cached };
  }
  const parked = [call, { ...end, stopReason: 'requires_action' }].reduce(
    reduceEvent,
    createInitialState(),
  );
  const calls = retry.selectCustomToolDispatchCalls(parked, true, store.getSnapshot(), Date.now());
  await requests.dispatchCustomCalls(scope, calls, new AbortController().signal);
  return { replays, errors };
}

test('a result posted after the agent stopped reloads the task so the reply is not lost', async () => {
  const posted = await dispatchWith([{ toolUseId: call.id, name: call.name, status: 'posted' }]);
  assert.deepEqual(posted, { replays: 1, errors: [] });
  const raced = new AppError('API_REQUEST_FAILED', 'Already resolved', {
    status: 400,
    serverCode: 'CUSTOM_TOOL_ALREADY_RESOLVED',
    serverToolUseId: call.id,
  });
  assert.deepEqual(await dispatchWith(raced), { replays: 1, errors: [] });
});

test('a call waiting for approval or still running is neither finished nor approved', async () => {
  assert.deepEqual(
    await dispatchWith([{ toolUseId: call.id, name: call.name, status: 'pending' }]),
    { replays: 0, errors: [] },
  );
  for (const detail of ['EXECUTING', 'DELIVERING', 'CLAIM_RACE', 'DELIVERY_PENDING'])
    assert.deepEqual(
      await dispatchWith([{ toolUseId: call.id, name: call.name, status: 'retry', detail }]),
      {
        replays: 0,
        errors: [],
      },
    );
});

test('an approval card goes only once the server has the answer', async () => {
  const delivering = await dispatchWith(
    [{ toolUseId: call.id, status: 'skipped', detail: 'DELIVERY_PENDING' }],
    'allow',
  );
  assert.deepEqual([delivering.cached.length, delivering.errors.length], [1, 1]);
  const resolved = await dispatchWith(
    [{ toolUseId: call.id, status: 'skipped', detail: 'NOT_PENDING' }],
    'allow',
  );
  assert.deepEqual([resolved.cached.length, resolved.errors.length], [0, 0]);
});

test('a stale or duplicate tool request move changes nothing', () => {
  const attempt = Symbol('attempt');
  const tools = new Map([
    ['pending', { kind: 'pending' }],
    ['confirming', { kind: 'confirming', attempt }],
    ['posted', { kind: 'posted' }],
    ['dispatching', { kind: 'dispatching', attempt, failures: 0 }],
    ['waiting', { kind: 'waiting', retryAt: 1000, failures: 1 }],
    ['exhausted', { kind: 'exhausted', failures: 3 }],
  ]);
  for (const action of [
    { type: 'pending', id: 'confirming' },
    { type: 'pending', id: 'posted' },
    { type: 'dispatch', ids: ['pending', 'posted', 'dispatching'], attempt: Symbol(), now: 0 },
    { type: 'dispatch', ids: ['waiting'], attempt: Symbol(), now: 999 },
    { type: 'progress', id: 'dispatching', attempt: Symbol(), now: 0 },
    { type: 'confirm', ids: ['confirming', 'posted', 'missing'], attempt: Symbol() },
    { type: 'posted', id: 'confirming', attempt: Symbol() },
    { type: 'posted', id: 'pending', attempt },
    { type: 'failed', ids: ['confirming', 'dispatching'], attempt: Symbol(), now: 0 },
    { type: 'failed', ids: ['pending', 'posted', 'missing'], attempt, now: 0 },
    { type: 'retry', ids: ['pending', 'waiting', 'missing'] },
    { type: 'cancel', ids: ['dispatching'], attempt: Symbol() },
  ])
    assertRefusedMove(toolRequestReducer, tools, action);
});

test('answering one approval leaves another waiting, and dispatch stops after three failures until retried', () => {
  const attempt = Symbol();
  let state = new Map();
  for (const id of ['first', 'second']) state = toolRequestReducer(state, { type: 'pending', id });
  state = toolRequestReducer(state, { type: 'confirm', ids: ['first'], attempt });
  state = toolRequestReducer(state, { type: 'posted', id: 'first', attempt });
  assert.deepEqual([state.get('first').kind, state.get('second').kind], ['posted', 'pending']);
  let failing = new Map();
  for (let index = 0; index < 3; index++) {
    const next = Symbol();
    failing = toolRequestReducer(failing, {
      type: 'dispatch',
      ids: ['tool'],
      attempt: next,
      now: index * 1000,
    });
    failing = toolRequestReducer(failing, {
      type: 'failed',
      ids: ['tool'],
      attempt: next,
      now: index * 1000,
    });
  }
  assert.equal(failing.get('tool').kind, 'exhausted');
  assert.equal(toolRequestReducer(failing, { type: 'retry', ids: ['tool'] }).has('tool'), false);
});
