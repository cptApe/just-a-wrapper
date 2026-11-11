// Folding provider events into the open chat: replays never duplicate rows, gates close once, and the final message wins.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  applyPreviewDelta,
  applyPreviewStart,
  selectPreviewText,
} from '../../src/features/chat/lib/chat-preview.ts';
import { createInitialState } from '../../src/features/chat/lib/chat-state.ts';
import { reduceEvent } from '../../src/features/chat/lib/chat-store.ts';
import { selectPendingGates } from '../../src/features/chat/lib/chat-turns.ts';
import { translateEvent } from '../../src/features/sessions/lib/relay-translator.ts';

const fixture = JSON.parse(
  readFileSync(
    new URL('../fixtures/anthropic/default-session-ready.json', import.meta.url),
    'utf8',
  ),
);
const captured = fixture.events.map(translateEvent).filter(Boolean);
const fold = (events, initial = createInitialState()) =>
  events
    .map((event) => ('kind' in event ? event : translateEvent(event)))
    .filter(Boolean)
    .reduce(reduceEvent, initial);
const shape = (state) => state.items.map((item) => ({ id: item.id, type: item.type }));

test('a reconnect that replays seen events shows no duplicate rows and the same text', () => {
  const clean = fold(captured);
  const beforeDrop = fold(captured.slice(0, 2));
  const replayed = fold(captured.slice(1), beforeDrop);
  assert.deepEqual(shape(replayed), shape(clean));
  assert.equal(reduceEvent(clean, captured[0]), clean, 'a seen event changes nothing');

  const reattached = fold(
    [
      ...captured,
      {
        id: 'sevt_t2_user',
        kind: 'message',
        rawType: 'user.message',
        role: 'user',
        text: 'again?',
      },
    ],
    clean,
  );
  assert.deepEqual(
    reattached.items.map((item) => item.id),
    [...clean.items.map((item) => item.id), 'sevt_t2_user'],
  );
});

test('a tool result lands on its tool card instead of becoming a second row', () => {
  const state = fold([
    {
      id: 'tool',
      kind: 'tool_use',
      rawType: 'agent.tool_use',
      tool: 'builtin',
      name: 'bash',
      input: {},
    },
    {
      id: 'result',
      kind: 'tool_result',
      rawType: 'agent.tool_result',
      toolUseId: 'tool',
      isError: false,
      text: 'ok',
    },
  ]);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].result.text, 'ok');
});

test('an approval waits until a confirmation or result arrives, and a replay never reopens it', () => {
  const ask = {
    id: 'sevt_gate',
    type: 'agent.mcp_tool_use',
    name: 'GMAIL_FETCH_EMAILS',
    mcp_server_name: 'composio',
    input: {},
    evaluated_permission: 'ask',
  };
  const confirm = {
    id: 'c',
    type: 'user.tool_confirmation',
    tool_use_id: 'sevt_gate',
    result: 'deny',
  };
  const result = {
    id: 'r',
    type: 'agent.mcp_tool_result',
    mcp_tool_use_id: 'sevt_gate',
    content: [],
  };
  assert.equal(selectPendingGates(fold([ask])).length, 1);
  assert.deepEqual(selectPendingGates(fold([{ ...ask, evaluated_permission: 'allow' }])), []);
  assert.deepEqual(selectPendingGates(fold([ask, result])), []);
  const denied = fold([ask, confirm]);
  assert.equal(denied.items.find((item) => item.id === 'sevt_gate').confirmation, 'deny');
  const replayed = fold([ask, confirm], denied);
  assert.equal(replayed.items.filter((item) => item.id === 'sevt_gate').length, 1);
  assert.deepEqual(selectPendingGates(replayed), []);
  assert.equal(fold([confirm]).items.length, 0, 'a confirmation without its tool adds no row');
});

test('the stored message replaces its streamed preview, and a late preview cannot bring old text back', () => {
  let state = applyPreviewStart(createInitialState(), {
    eventId: 'p1',
    previewType: 'agent.message',
  });
  state = applyPreviewDelta(state, { eventId: 'p1', index: 0, text: 'partial' });
  assert.equal(selectPreviewText(state), 'partial');
  state = reduceEvent(state, {
    id: 'other',
    kind: 'message',
    rawType: 'agent.message',
    role: 'assistant',
    text: 'older',
  });
  assert.equal(selectPreviewText(state), 'partial', 'another message leaves the live preview');
  state = reduceEvent(state, {
    id: 'p1',
    kind: 'message',
    rawType: 'agent.message',
    role: 'assistant',
    text: 'final',
  });
  assert.equal(state.activity.preview.kind, 'idle');
  assert.equal(state.items.find((item) => item.id === 'p1').text, 'final');
  const late = applyPreviewDelta(
    applyPreviewStart(state, { eventId: 'p1', previewType: 'agent.message' }),
    {
      eventId: 'p1',
      index: 0,
      text: 'stale',
    },
  );
  assert.equal(late.activity.preview.kind, 'idle');
});

test('a preview left open by a failed request closes when the request or turn ends', () => {
  for (const end of [
    {
      id: 'end',
      kind: 'usage',
      rawType: 'span.model_request_end',
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    },
    { id: 'idle', kind: 'status', rawType: 'session.status_idle', status: 'idle' },
  ]) {
    let state = applyPreviewStart(createInitialState(), {
      eventId: 'p1',
      previewType: 'agent.message',
    });
    state = applyPreviewDelta(state, { eventId: 'p1', index: 0, text: 'never stored' });
    assert.equal(reduceEvent(state, end).activity.preview.kind, 'idle', end.rawType);
  }
});

test('a new file from the agent refreshes the file list once, and a replay does not refresh again', () => {
  const withFile = translateEvent({
    id: 'sevt_a1',
    type: 'agent.message',
    content: [
      { type: 'text', text: 'done' },
      { type: 'document', source: { type: 'file', file_id: 'file_1' }, title: null },
      { type: 'document', source: { type: 'url', url: 'https://example.com/x.pdf' } },
    ],
  });
  assert.deepEqual(withFile.fileRefs, [{ fileId: 'file_1', blockType: 'document', title: null }]);
  const plain = translateEvent({
    id: 'p',
    type: 'agent.message',
    content: [{ type: 'text', text: 'hi' }],
  });
  let state = fold([plain, withFile]);
  assert.equal(state.artifactSignal, 1);
  state = reduceEvent(state, withFile);
  assert.equal(state.artifactSignal, 1);
});
