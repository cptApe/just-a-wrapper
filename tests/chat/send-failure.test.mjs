/** One table turns a refused send into what the composer shows: Add credits, a limit, or a plain retry. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifySendFailure,
  TASK_SEND_FAILED_MESSAGE,
  taskComposerFailureMessage,
} from '../../src/features/chat/lib/classify-send-failure.ts';
import { AppError, BillingError } from '../../src/lib/errors.ts';

const STATUS_LINE = 'POST /api/sessions/s/send failed (402)';
const route = (context) => new AppError('API_REQUEST_FAILED', STATUS_LINE, context);

test('each refusal reaches the composer as the right kind', () => {
  const cases = [
    [new BillingError('CREDITS_EXHAUSTED', 'no credits'), 'credits-exhausted'],
    [route({ status: 402, serverCode: 'CREDITS_EXHAUSTED' }), 'credits-exhausted'],
    [
      route({ status: 402, serverCode: 'CREDITS_EXHAUSTED', serverReason: 'member_limit' }),
      'member-limit',
    ],
    [
      new BillingError('CREDITS_EXHAUSTED', 'ask an admin', { serverReason: 'member_limit' }),
      'member-limit',
    ],
    [new BillingError('PLAN_LIMIT_REACHED', 'three at once'), 'plan-limit'],
    [route({ status: 402, serverCode: 'PLAN_LIMIT_REACHED' }), 'plan-limit'],
    [route({ status: 409, serverCode: 'AWAITING_TOOL_RESULT' }), 'awaiting-tool-result'],
    // A failed file is about that file, even when the file was refused for credits or size.
    [
      new AppError('CREDITS_EXHAUSTED', 'Couldn’t attach a.pdf.', { failed: [{ name: 'a.pdf' }] }),
      'attachments-failed',
    ],
    [new AppError('PLAN_LIMIT_REACHED', 'too big'), 'other'],
    [route({ status: 503, serverCode: 'EXTERNAL_API_FAILED' }), 'other'],
    [route({ status: 500 }), 'other'],
    [new Error('boom'), 'other'],
  ];
  for (const [error, kind] of cases)
    assert.equal(classifySendFailure(error).kind, kind, error.message);
});

test("a refusal shows the server's sentence or a fallback, never the request status line", () => {
  for (const [serverCode, kind] of [
    ['CREDITS_EXHAUSTED', 'credits-exhausted'],
    ['PLAN_LIMIT_REACHED', 'plan-limit'],
    ['AWAITING_TOOL_RESULT', 'awaiting-tool-result'],
  ]) {
    const explained = route({ status: 402, serverCode, serverMessage: 'The server says why.' });
    assert.deepEqual(classifySendFailure(explained), { kind, message: 'The server says why.' });
    const bare = classifySendFailure(route({ status: 402, serverCode }));
    assert.equal(bare.kind, kind);
    assert.ok(bare.message.length > 0);
    assert.notEqual(bare.message, STATUS_LINE);
  }
  for (const serverCode of ['EXTERNAL_API_FAILED', 'WORKSPACE_CHANGED'])
    assert.deepEqual(
      classifySendFailure(route({ status: 503, serverCode, serverMessage: 'Try again.' })),
      {
        kind: 'upstream',
        message: 'Try again.',
      },
    );
});

test('a task send failure says why, and leaves billing and approval refusals to their banners', () => {
  assert.equal(taskComposerFailureMessage(route({ status: 500 })), TASK_SEND_FAILED_MESSAGE);
  assert.equal(
    taskComposerFailureMessage(
      route({ status: 503, serverCode: 'EXTERNAL_API_FAILED', serverMessage: 'Down.' }),
    ),
    'Down.',
  );
  for (const serverCode of ['AWAITING_TOOL_RESULT', 'CREDITS_EXHAUSTED', 'PLAN_LIMIT_REACHED'])
    assert.equal(taskComposerFailureMessage(route({ serverCode })), null);
});
