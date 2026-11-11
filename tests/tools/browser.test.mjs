/** The shared workspace browser: who may hold it, whose browsing a member may replay, and that a
 * page read always returns. Leases, billing and cleanup on Postgres are in
 * tests/integration/browser-*.test.ts and tool-delivery.test.ts. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordedBrowserbaseSessionIds } from '../../src/features/tools/lib/browse-replay.ts';
import { browserControlIsLive } from '../../src/features/tools/lib/browser-machine.ts';
import {
  INITIAL_BROWSER_PANEL_STATE,
  reduceBrowserPanel,
} from '../../src/features/tools/lib/browser-panel-state.ts';
import { workspaceBrowserHolderDecision } from '../../src/features/tools/lib/browser-reclaim.ts';
import { settlePageText } from '../../src/features/tools/lib/page-text-settle.ts';

test('the workspace browser is taken from a holder only when it is idle and no person drives it', () => {
  for (const status of ['running', 'rescheduling', 'requires_input']) {
    assert.equal(workspaceBrowserHolderDecision({ status, controlledByUser: false }), 'busy');
  }
  for (const status of ['idle', null]) {
    assert.equal(workspaceBrowserHolderDecision({ status, controlledByUser: true }), 'busy');
  }
  for (const status of ['idle', 'paused_no_credits', 'terminated', null]) {
    assert.equal(workspaceBrowserHolderDecision({ status, controlledByUser: false }), 'reclaim');
  }
});

test("a person's control of the browser ends when its lease does", () => {
  assert.equal(browserControlIsLive('user', new Date(100), 99), true);
  assert.equal(browserControlIsLive('user', new Date(100), 100), false);
  assert.equal(browserControlIsLive('user', null, 99), false);
  assert.equal(browserControlIsLive('acting', new Date(100), 99), false);
});

// Mirrors the server's parseCustomToolResult: JSON object or null.
function parseResult(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  const parsed = JSON.parse(trimmed);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
}
function toolEvents(useId, name, browserbaseSessionId) {
  return [
    { type: 'agent.custom_tool_use', id: useId, name, input: { url: 'https://x' } },
    {
      type: 'user.custom_tool_result',
      id: `${useId}-result`,
      custom_tool_use_id: useId,
      content: [{ type: 'text', text: JSON.stringify({ url: 'https://x', browserbaseSessionId }) }],
    },
  ];
}

test("a member can replay only browsers this chat's own browse calls opened", () => {
  const recorded = recordedBrowserbaseSessionIds(
    [
      ...toolEvents('use_a', 'browse_page', 'bb_page'),
      ...toolEvents('use_b', 'browse_open', 'bb_open'),
      // Another tool echoing the field cannot widen the set.
      ...toolEvents('use_x', 'fetch_page', 'bb_spoofed'),
    ],
    parseResult,
  );
  assert.deepEqual([...recorded].sort(), ['bb_open', 'bb_page']);
  assert.equal(recordedBrowserbaseSessionIds([], parseResult).size, 0);
});

test('a failed poll or a refreshed token never reloads the live view or drops the person’s control', () => {
  const live = {
    status: 'live',
    browserbaseSessionId: 'bb_123',
    debuggerFullscreenUrl: 'https://debug.example.test/session',
    url: 'https://example.com',
    title: 'Example',
    browserStatus: 'user',
  };
  const opened = reduceBrowserPanel(INITIAL_BROWSER_PANEL_STATE, { type: 'loaded', view: live });
  assert.equal(opened.browserStatus, 'user');
  assert.equal(reduceBrowserPanel(opened, { type: 'poll_failed' }), opened);
  const refreshed = reduceBrowserPanel(opened, {
    type: 'loaded',
    view: { ...live, debuggerFullscreenUrl: 'https://new-token.example' },
  });
  assert.equal(refreshed.debuggerFullscreenUrl, opened.debuggerFullscreenUrl);
});

test('a page read waits for a single-page app to settle, and still returns if the page hangs', async () => {
  let elapsedMs = 0;
  const samples = ['shell', 'loading products', 'products in stock', 'products in stock'];
  let index = 0;
  const text = await settlePageText({
    now: () => elapsedMs,
    sample: async () => samples[Math.min(index++, samples.length - 1)],
    sleep: async (ms) => {
      elapsedMs += ms;
    },
    budgetMs: 5_000,
    intervalMs: 250,
    minMeaningfulChars: 10,
  });
  assert.equal(text, 'products in stock');

  let calls = 0;
  const hung = await settlePageText({
    sample: async () => (++calls === 1 ? 'last completed' : new Promise(() => undefined)),
    sleep: async () => undefined,
    now: Date.now,
    budgetMs: 5,
    intervalMs: 1,
    minMeaningfulChars: 10,
  });
  assert.equal(hung, 'last completed');
});
