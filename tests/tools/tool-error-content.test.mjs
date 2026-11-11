/** What a failed tool puts in the chat: never a credential, never a raw internal error. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeBrowserDetail } from '../../src/features/tools/lib/browser-failure-detail.ts';
import {
  toolErrorContent,
  UNKNOWN_TOOL_ERROR_MESSAGE,
} from '../../src/features/tools/lib/tool-error-content.ts';
import { AppError } from '../../src/lib/errors.ts';

test('an unexpected exception reaches the chat as a generic message, not its database text', () => {
  const content = toolErrorContent(
    new Error('Failed query: select credit_balance from workspace params: private-workspace-id'),
  );
  assert.deepEqual(content, { code: 'TOOL_HANDLER_FAILED', message: UNKNOWN_TOOL_ERROR_MESSAGE });
  assert.equal(
    toolErrorContent(new AppError('UNEXPECTED', 'm', { detail: 'raw body' })).detail,
    undefined,
  );
});

test('API keys, signing keys and live-view tokens are redacted before they reach the chat', () => {
  assert.match(
    toolErrorContent(new AppError('UNEXPECTED', 'key bb_live_SECRET failed')).message,
    /^key \[redacted\] failed/,
  );
  assert.equal(
    toolErrorContent(new AppError('UNEXPECTED', 'm', { chatDetail: 'key bb_live_SECRET here' }))
      .detail,
    'key [redacted] here',
  );
  const clean = sanitizeBrowserDetail(
    [
      'connect wss://connect.usw2.browserbase.com/?signingKey=abc.def-ghi failed',
      'debugger https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=connect.browserbase.com/debug/1/devtools/page/2?t=eyJhbGciOi.secret&debug=true',
      'key bb_live_AbC123-xyz and sk-ant-api03-SECRET and Bearer tok.en_1',
      'header X-BB-API-Key: bb_test_zzz',
    ].join(' '),
  );
  for (const secret of [
    /abc\.def-ghi/,
    /eyJhbGciOi/,
    /bb_live_/,
    /bb_test_/,
    /sk-ant-/,
    /tok\.en_1/,
  ]) {
    assert.doesNotMatch(clean, secret);
  }
  assert.match(clean, /failed/);
});
