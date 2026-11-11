// The browser relay: every event reaches the browser exactly once, gates resolve once, and usage is billed once.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONFIRMATION,
  createInitialState,
  GATED_TOOL,
  installClient,
  readFrames,
  reduceEvent,
  selectPendingGates,
} from './relay-fixture.mjs';

const gate = async () => 'gate';
const allow = async () => 'allow';
const meta = (lastSeenEventId = null) => ({
  type: 'meta',
  sessionId: 'session_test',
  traceId: 'trace_test',
  lastSeenEventId,
});
const historyFrame = { type: 'history' };
const closed = { type: 'done', reason: 'closed' };
const raw = (id) => ({ id, type: 'future.event' });
const rawFrame = (id) => ({ type: 'event', event: { id, kind: 'raw', rawType: 'future.event' } });
const toolFrame = (frames) =>
  frames.find((frame) => frame.type === 'event' && frame.event.id === GATED_TOOL.id);
const pendingGates = (frame) => selectPendingGates(reduceEvent(createInitialState(), frame.event));

test('a reconnect replays only what the browser has not seen, and an unknown cursor replays everything', async () => {
  for (const [cursor, expected] of [
    ['one', [rawFrame('two')]],
    ['stale', [rawFrame('one'), rawFrame('two')]],
  ]) {
    installClient({ history: [raw('one'), raw('two')] });
    assert.deepEqual(await readFrames(gate, { lastEventId: cursor }), [
      meta(cursor),
      ...expected,
      historyFrame,
      closed,
    ]);
  }
});

test('an event in both history and the live stream reaches the browser once', async () => {
  installClient({ history: [raw('one')], live: [raw('one'), raw('two')] });
  assert.deepEqual(await readFrames(gate), [
    meta(),
    rawFrame('one'),
    historyFrame,
    rawFrame('two'),
    closed,
  ]);
});

test('a long chat replays its whole transcript on a fresh attach', async () => {
  const history = Array.from({ length: 1001 }, (_, index) => ({
    id: `sevt_message_${index}`,
    type: 'agent.message',
    content: [{ type: 'text', text: `Message ${index}` }],
    processed_at: new Date(1_700_000_000_000 + index).toISOString(),
  }));
  installClient({ history });
  const frames = await readFrames(gate);
  assert.equal(frames.filter((frame) => frame.type === 'event').length, history.length);
});

test('the latest status in history corrects the stored status even when the cursor hides it', async () => {
  const observations = installClient({
    history: [
      { id: 'running', type: 'session.status_running' },
      { id: 'idle', type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
    ],
  });
  await readFrames(gate, { lastEventId: 'idle' });
  assert.deepEqual(observations.statuses, [
    { kind: 'reconcile', anthropicSessionId: 'session_test', allowFromPause: false },
  ]);
});

test('a stalled stream closes so the browser reconnects, and an event after a heartbeat is not lost', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 });
  let finishRead;
  installClient({
    iterator: {
      next: () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
      return: () => Promise.resolve({ done: true }),
    },
    reconciledHistory: [{ id: 'missed', processed_at: new Date(0).toISOString() }],
  });
  const stalled = readFrames(gate);
  await new Promise(setImmediate);
  t.mock.timers.tick(25_000);
  assert.deepEqual(await stalled, [meta(), historyFrame, closed]);

  let reads = 0;
  installClient({
    iterator: {
      next() {
        reads += 1;
        return reads === 1
          ? new Promise((resolve) => {
              finishRead = resolve;
            })
          : Promise.resolve({ done: true });
      },
    },
  });
  const live = readFrames(gate);
  await new Promise(setImmediate);
  t.mock.timers.tick(25_000);
  await new Promise(setImmediate);
  finishRead({ done: false, value: raw('after-heartbeat') });
  assert.deepEqual(await live, [
    meta(),
    historyFrame,
    { type: 'heartbeat', t: 25_000 },
    rawFrame('after-heartbeat'),
    closed,
  ]);
});

test('a relay failure sends the browser only an error code, never the server message', async () => {
  const captured = [];
  installClient({
    streamOpen: async () => {
      throw new Error('ANTHROPIC_API_KEY is not set for this deployment');
    },
  });
  globalThis.__relayCaptureException = (error) => captured.push(error);
  const { sessionEventStream } = await import(
    '../../src/features/session-runtime/api/session-event-relay.ts'
  );
  const payload = await new Response(
    sessionEventStream({
      sessionId: 'session_test',
      lastEventId: null,
      signal: new AbortController().signal,
      traceId: 'trace_test',
      resolveGate: gate,
    }),
  ).text();
  assert.equal(captured.length, 1);
  assert.ok(!payload.includes('ANTHROPIC_API_KEY'), payload);
  assert.ok(payload.includes('{"type":"error","code":"RELAY_FAILED"}'), payload);
});

test('an auto-allowed tool is confirmed once, live or from history, and never shows as waiting', async () => {
  for (const source of ['live', 'history']) {
    const observations = installClient({ [source]: [GATED_TOOL] });
    const frame = toolFrame(await readFrames(allow));
    assert.deepEqual(observations.sent, [
      { type: 'user.tool_confirmation', tool_use_id: GATED_TOOL.id, result: 'allow' },
    ]);
    assert.equal(frame.event.confirmation, 'allow');
    assert.deepEqual(pendingGates(frame), []);
  }
});

test('a tool that needs the person waits for them and is never confirmed by the relay', async () => {
  const observations = installClient({ live: [GATED_TOOL] });
  const frame = toolFrame(await readFrames(gate));
  assert.deepEqual(observations.sent, []);
  assert.equal(pendingGates(frame).length, 1);
});

test('a confirmation already in history is not sent again', async () => {
  const observations = installClient({ history: [GATED_TOOL, CONFIRMATION] });
  const frame = toolFrame(await readFrames(gate));
  assert.equal(frame.event.confirmation, 'allow');
  assert.deepEqual(observations.sent, []);
});

test('when another relay confirmed first, the loser reads it back; with no record the gate stays visible', async () => {
  const raced = installClient({
    live: [GATED_TOOL, CONFIRMATION],
    reconciledPages: [[CONFIRMATION]],
    sendError: new Error('already confirmed'),
  });
  const won = toolFrame(await readFrames(allow));
  assert.equal(won.event.confirmation, 'allow');
  assert.deepEqual(pendingGates(won), []);
  assert.equal(raced.sent.length, 1);

  installClient({
    live: [GATED_TOOL],
    reconciledPages: [[], []],
    sendError: new Error('confirmation unavailable'),
  });
  const failed = toolFrame(await readFrames(allow));
  assert.equal(failed.event.confirmation, undefined);
  assert.equal(pendingGates(failed).length, 1);
});

test('replaying many finished turns bills every model request once and the session end once', async () => {
  const history = [];
  for (let turn = 0; turn < 5; turn++)
    history.push(
      {
        id: `request-${turn}`,
        type: 'span.model_request_end',
        processed_at: '2026-11-08T00:00:00Z',
        model_usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      { id: `idle-${turn}`, type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
    );
  const ends = [];
  const requests = [];
  installClient({ history });
  globalThis.__relayAccrueSessionEnd = async (sessionId, input) => ends.push({ sessionId, input });
  globalThis.__relayAccrueModelRequest = async (input) => requests.push(input.anthropicEventId);
  await readFrames(gate);
  assert.deepEqual(ends, [
    {
      sessionId: 'session_test',
      input: { anthropicEventId: 'idle-4', runtime: { kind: 'fetch' } },
    },
  ]);
  assert.deepEqual(requests, ['request-0', 'request-1', 'request-2', 'request-3', 'request-4']);
});

test('usage is reconciled at the provider list cost in US cents, and a cost we cannot read is skipped', async () => {
  for (const [listCost, expected] of [
    [undefined, null],
    [{ amount: '0', currency: 'USD' }, 0],
    [{ amount: '12', currency: 'USD' }, 12],
    [{ amount: '12', currency: 'EUR' }, 'skipped'],
    [{ amount: '12.5', currency: 'USD' }, 'skipped'],
  ]) {
    const reconciliations = [];
    installClient({
      live: [
        {
          id: 'usage',
          processed_at: '2026-11-08T00:00:00Z',
          type: 'session.usage',
          usage: { input_tokens: 10, output_tokens: 2, list_cost: listCost },
          budget: null,
        },
      ],
    });
    globalThis.__relayAccrueUsageReconciliation = async (input) => reconciliations.push(input);
    await readFrames(gate);
    assert.deepEqual(
      reconciliations.map((input) => input.listCostMinorUnits),
      expected === 'skipped' ? [] : [expected],
      JSON.stringify(listCost),
    );
  }
});
