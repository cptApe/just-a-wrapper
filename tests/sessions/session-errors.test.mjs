import '../support/env.mjs';
// What a session route answers when something fails: a provider outage is a readable 503, and no internal detail leaks.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const stubs = {
  'server-only': 'export {}',
  '@/db': 'export const db = {};',
  '@/db/schema': 'export const session = {};',
  '@/lib/caller': 'export const resolveCaller = async () => ({});',
  '@/lib/request-context': 'export const extend = () => {};',
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './observability' && context.parentURL.endsWith('/src/lib/route-kit.ts'))
      return {
        url: 'data:text/javascript,export const captureException=()=>{};export const flushObservability=async()=>{}',
        shortCircuit: true,
      };
    const stub = stubs[specifier];
    if (stub)
      return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { APIError, APIConnectionError } = await import('@anthropic-ai/sdk');
const { AppError, BillingError } = await import('../../src/lib/errors.ts');
const { sessionRouteErrorResponse, UPSTREAM_BUSY_MESSAGE, UPSTREAM_UNAVAILABLE_MESSAGE } =
  await import('../../src/features/sessions/api/session-access.ts');

const upstream = (status, type, message) =>
  APIError.generate(status, { type: 'error', error: { type, message } }, undefined, new Headers());

async function answer(error) {
  const response = sessionRouteErrorResponse(error);
  return { status: response.status, error: (await response.json()).error };
}

test('a provider outage, rate limit or empty operator account answers 503 with a sentence the composer shows', async () => {
  const busy = { code: 'EXTERNAL_API_FAILED', message: UPSTREAM_BUSY_MESSAGE };
  const down = { code: 'EXTERNAL_API_FAILED', message: UPSTREAM_UNAVAILABLE_MESSAGE };
  for (const [error, expected] of [
    [
      upstream(
        400,
        'invalid_request_error',
        'Your credit balance is too low to access the Anthropic API.',
      ),
      down,
    ],
    [upstream(400, 'billing_error', 'Billing problem'), down],
    [upstream(429, 'rate_limit_error', 'Rate limited'), busy],
    [upstream(529, 'overloaded_error', 'Overloaded'), busy],
    [upstream(500, 'api_error', 'Internal server error'), down],
    [upstream(401, 'authentication_error', 'invalid x-api-key'), down],
    [new APIConnectionError({ message: 'Connection error.' }), down],
    [
      new AppError(
        'EXTERNAL_API_FAILED',
        'Skills',
        {},
        { cause: upstream(429, 'rate_limit_error', 'x') },
      ),
      busy,
    ],
  ])
    assert.deepEqual(await answer(error), { status: 503, error: expected }, error.message);
});

test('our own bugs stay 500, a plan limit keeps its 402 sentence, and a waiting approval is a 409', async () => {
  const unexpected = { status: 500, error: { code: 'UNEXPECTED', message: 'Unexpected error' } };
  assert.deepEqual(
    await answer(upstream(400, 'invalid_request_error', 'agent: field required')),
    unexpected,
  );
  assert.deepEqual(await answer(new Error('boom')), unexpected);
  assert.deepEqual(
    await answer(new BillingError('PLAN_LIMIT_REACHED', 'Your plan allows 1 chat at a time.', {})),
    {
      status: 402,
      error: { code: 'PLAN_LIMIT_REACHED', message: 'Your plan allows 1 chat at a time.' },
    },
  );
  const waiting = await answer(
    new AppError('SESSION_BUSY', 'Waiting', {
      reason: 'awaiting-tool-result',
      expectedState: true,
    }),
  );
  assert.equal(waiting.status, 409);
  assert.equal(waiting.error.code, 'AWAITING_TOOL_RESULT');
});

test('an error answer never carries keys, secrets or database detail', async () => {
  for (const [code, status] of [
    ['EXTERNAL_API_FAILED', 503],
    ['UNEXPECTED', 500],
    ['INVALID_BODY', 400],
  ]) {
    const response = await answer(
      new AppError(code, 'ANTHROPIC_API_KEY secret database detail', { expectedState: true }),
    );
    assert.equal(response.status, status);
    assert.doesNotMatch(response.error.message, /ANTHROPIC|secret|database/);
  }
});
