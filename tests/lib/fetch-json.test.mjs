// The browser fetch helpers turn every failure into one typed error that keeps the server code
// the UI reads (out of credits, workspace changed, tool already resolved). `fetch` is replaced.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { AppError } from '../../src/lib/errors.ts';
import { fetchJson, fetchVoid } from '../../src/lib/fetch-json.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const respond = (body, status) => {
  globalThis.fetch = async () => new Response(body, { status });
};
const failure = (check) => (error) => {
  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'API_REQUEST_FAILED');
  check(error.context, error);
  return true;
};

test('a refusal keeps the server code, message, tool id and expected flag the UI acts on', async () => {
  respond(
    JSON.stringify({
      error: {
        code: 'CREDITS_EXHAUSTED',
        message: 'no credits',
        toolUseId: 'tool_resolved',
        expectedState: true,
      },
    }),
    402,
  );
  for (const call of [fetchJson('/api/billing/topup'), fetchVoid('/api/sessions/s1/send')]) {
    await assert.rejects(
      call,
      failure((context) => {
        assert.equal(context.status, 402);
        assert.equal(context.serverCode, 'CREDITS_EXHAUSTED');
        assert.equal(context.serverMessage, 'no credits');
        assert.equal(context.serverToolUseId, 'tool_resolved');
        assert.equal(context.expectedState, true);
      }),
    );
  }
  // A malformed optional field does not discard a valid code.
  respond(JSON.stringify({ error: { code: 'FORBIDDEN', message: null, toolUseId: 42 } }), 403);
  await assert.rejects(
    fetchJson('/api/thing'),
    failure((context) => {
      assert.equal(context.serverCode, 'FORBIDDEN');
      assert.equal(context.serverToolUseId, undefined);
    }),
  );
});

test('an HTML error page, a string error, a dropped network or bad JSON still fail typed', async () => {
  for (const [body, status] of [
    ['<html>502 Bad Gateway</html>', 502],
    [JSON.stringify({ error: 'nope' }), 400],
    ['not json at all', 200],
    ['   ', 200],
    [null, 204],
  ]) {
    respond(body, status);
    await assert.rejects(
      fetchJson('/api/thing'),
      failure((context) => {
        assert.equal(context.status, status);
        assert.equal(context.serverCode, undefined);
      }),
    );
  }
  const cause = new TypeError('Failed to fetch');
  globalThis.fetch = async () => {
    throw cause;
  };
  await assert.rejects(
    fetchJson('/api/thing'),
    failure((context, error) => {
      assert.equal(context.status, undefined);
      assert.equal(error.cause, cause);
    }),
  );
});

test('a success returns the body, and fetchVoid accepts any success body', async () => {
  respond(JSON.stringify({ ok: true, n: 7 }), 200);
  assert.deepEqual(await fetchJson('/api/thing'), { ok: true, n: 7 });
  assert.equal(await fetchVoid('/api/thing', { method: 'POST' }), undefined);
  respond(null, 204);
  assert.equal(await fetchVoid('/api/thing', { method: 'DELETE' }), undefined);
});
