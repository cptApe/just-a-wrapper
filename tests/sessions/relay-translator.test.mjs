// Provider events to chat rows: no event silently vanishes, results reach their tool card, and usage totals add up.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  classifyEventType,
  isTerminalStreamEvent,
  translateEvent,
} from '../../src/features/sessions/lib/relay-translator.ts';

const fixture = JSON.parse(
  readFileSync(
    new URL('../fixtures/anthropic/default-session-ready.json', import.meta.url),
    'utf8',
  ),
);

test('every captured provider event is either shown with its own id or knowingly dropped', () => {
  for (const event of fixture.events) {
    const klass = classifyEventType(event.type);
    assert.notEqual(klass, 'unknown', `event type "${event.type}" is unhandled`);
    const row = translateEvent(event);
    if (klass === 'forward') assert.equal(row?.id, event.id, event.type);
    else assert.equal(row, null, event.type);
  }
});

test('a new provider event type still shows as a raw row, unless it has no id to resume from', () => {
  const future = translateEvent({ id: 'sevt_future', type: 'agent.future_event_2027' });
  assert.deepEqual(future, { id: 'sevt_future', kind: 'raw', rawType: 'agent.future_event_2027' });
  assert.equal(translateEvent({ type: 'brand.no_id' }), null);
});

test('a custom tool result posted by the app settles the tool card it answers', () => {
  const row = translateEvent({
    id: 'sevt_custom_result',
    type: 'user.custom_tool_result',
    custom_tool_use_id: 'sevt_custom',
    is_error: true,
    content: [{ type: 'text', text: 'No memory at that path.' }],
  });
  assert.equal(row.kind, 'tool_result');
  assert.equal(row.toolUseId, 'sevt_custom');
  assert.equal(row.isError, true);
});

test('a usage snapshot counts both cache-write buckets', () => {
  const row = translateEvent({
    id: 'sevt_snapshot',
    type: 'session.usage',
    usage: {
      input_tokens: 100,
      output_tokens: 25,
      cache_creation: { ephemeral_1h_input_tokens: 7, ephemeral_5m_input_tokens: 3 },
      cache_read_input_tokens: 40,
    },
  });
  assert.deepEqual(row.usage, {
    inputTokens: 100,
    outputTokens: 25,
    cacheCreationTokens: 10,
    cacheReadTokens: 40,
  });
});

test('only a finished turn or termination closes the stream; waiting for approval keeps it open', () => {
  for (const [event, terminal] of [
    [{ type: 'agent.message' }, false],
    [{ type: 'session.status_running' }, false],
    [{ type: 'session.status_idle', stop_reason: { type: 'requires_action' } }, false],
    [{ type: 'session.status_idle', stop_reason: { type: 'end_turn' } }, true],
    [{ type: 'session.status_terminated' }, true],
    [{ type: 'event_start', event: { type: 'agent.message', id: 'p' } }, false],
  ])
    assert.equal(isTerminalStreamEvent(event), terminal, JSON.stringify(event));
});
