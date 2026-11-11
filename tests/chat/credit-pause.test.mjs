/** A task out of credits pauses cleanly and resumes; credit refusals never read as failures. Real store, no mocks. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPreviewDelta, applyPreviewStart } from '../../src/features/chat/lib/chat-preview.ts';
import { createInitialState } from '../../src/features/chat/lib/chat-state.ts';
import { reduceEvent, workspaceStatusEvent } from '../../src/features/chat/lib/chat-store.ts';
import { composerSendMode, isChatWorking } from '../../src/features/chat/lib/chat-working.ts';
import { isCreditStopError, isCreditStopResult } from '../../src/features/chat/lib/credit-stop.ts';
import { isCreditsRequired } from '../../src/features/chat/lib/credits-required-machine.ts';
import {
  isFailedToolCall,
  toolStatusOf,
} from '../../src/features/chat/lib/tool-display-activity.ts';

const running = {
  id: 'running-1',
  kind: 'status',
  rawType: 'session.status_running',
  status: 'running',
};
const tool = { type: 'tool', id: 'tool-1', tool: 'custom', name: 'browse_act', input: {} };
const working = (state) =>
  isChatWorking({
    state,
    streamStatus: 'open',
    sendInFlight: true,
    pendingUserToolUseIds: new Set(),
    autoDispatchToolUseIds: new Set([tool.id]),
  });

test('a pause stops the running turn without losing the replay cursor', () => {
  let state = reduceEvent(createInitialState(), running);
  state = applyPreviewStart(
    { ...state, items: [tool] },
    { eventId: 'thinking', previewType: 'agent.thinking' },
  );
  state = reduceEvent(state, workspaceStatusEvent('paused_no_credits'));
  assert.equal(working(state), false);
  assert.equal(state.activity.preview.kind, 'idle');
  assert.equal(applyPreviewStart(state, { eventId: 'late', previewType: 'agent.thinking' }), state);
  assert.equal(applyPreviewDelta(state, { eventId: 'late-text', index: 0, text: 'late' }), state);
  assert.equal(state.lastEventId, running.id);
  assert.equal(toolStatusOf(state.items[0], { live: working(state) }), 'interrupted');
});

test('a late relay status cannot lift a pause; the workspace resuming does', () => {
  let state = reduceEvent(createInitialState(), workspaceStatusEvent('paused_no_credits'));
  for (const status of ['running', 'idle']) {
    state = reduceEvent(state, { ...running, id: status, status });
    assert.equal(state.status, 'paused_no_credits');
  }
  state = reduceEvent(state, workspaceStatusEvent('running'));
  assert.equal(working(state), true);
  state = reduceEvent(state, workspaceStatusEvent('paused_no_credits'));
  assert.equal(working(state), false, 'a second pause is not deduplicated away');
});

test('a paused task offers Send, not Stop, whatever stale flags say', () => {
  assert.equal(composerSendMode({ paused: true, running: true, stopping: true }), 'send');
  assert.equal(composerSendMode({ paused: false, running: true, stopping: false }), 'stop');
  assert.equal(composerSendMode({ paused: false, running: true, stopping: true }), 'stopping');
});

test('billing errors leave no error row; the pause alone says why', () => {
  for (const retryStatus of ['retrying', 'exhausted', 'terminal']) {
    const billing = {
      id: 'billing',
      kind: 'error',
      rawType: 'session.error',
      text: 'No credits',
      errorType: 'billing_error',
      retryStatus,
    };
    let state = reduceEvent(createInitialState(), billing);
    state = reduceEvent(state, workspaceStatusEvent('paused_no_credits'));
    state = reduceEvent(state, billing);
    assert.equal(state.status, 'paused_no_credits');
    assert.deepEqual(state.items, []);
  }
});

test('a tool refused for credits reads as paused, while a real failure stays a failure', () => {
  const refused = {
    name: 'generate_image',
    result: {
      isError: true,
      text: JSON.stringify({ code: 'CREDITS_EXHAUSTED', message: 'No credits' }),
    },
  };
  assert.equal(isFailedToolCall(refused), false);
  assert.equal(toolStatusOf(refused), 'paused');
  assert.equal(
    toolStatusOf({
      name: 'generate_image',
      result: { isError: true, text: '{"code":"TOOL_FAILED"}' },
    }),
    'failed',
  );
  assert.equal(isCreditStopError('model_overloaded'), false);
  assert.equal(isCreditStopResult({ isError: false, text: '{"code":"CREDITS_EXHAUSTED"}' }), false);
});

test('only a confirmed empty balance without a plan asks for credits', () => {
  const cases = [
    [{ kind: 'ready', creditBalance: 0, hasPlan: false }, true],
    [{ kind: 'ready', creditBalance: -3, hasPlan: false }, true],
    [{ kind: 'ready', creditBalance: 1, hasPlan: false }, false],
    [{ kind: 'ready', creditBalance: 0, hasPlan: true }, false],
    [{ kind: 'loading' }, false],
    [{ kind: 'error' }, false],
    [{ kind: 'off' }, false],
  ];
  for (const [credits, required] of cases)
    assert.equal(isCreditsRequired(credits), required, JSON.stringify(credits));
});
