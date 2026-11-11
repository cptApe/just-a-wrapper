// What a route or server action answers when something fails: the right status, no internal
// detail in the body, a stale workspace refused, and cron routes closed without the secret.
import { registerHooks } from 'node:module';

const routeLogs = [];
globalThis.__routeLog = (entry) => routeLogs.push(entry);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/server')
      return { url: 'data:text/javascript,export const after = () => {};', shortCircuit: true };
    if (specifier === './logger' && context.parentURL?.endsWith('/src/lib/route-kit.ts'))
      return {
        url: 'data:text/javascript,export const shipLog = (entry) => globalThis.__routeLog(entry);',
        shortCircuit: true,
      };
    return nextResolve(specifier, context);
  },
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { assertExpectedOrganization } from '../../src/lib/assert-expected-organization.ts';
import { AppError, CapabilityOffError } from '../../src/lib/errors.ts';
import { isExpectedUserStateError } from '../../src/lib/expected-state-error.ts';
import { ROUTE_ERROR_MESSAGES } from '../../src/lib/route-error-messages.ts';

// env.ts validates at load, so real-shaped throwaway values go in before route-kit is imported.
process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/test';
process.env.BETTER_AUTH_SECRET ??= 'x'.repeat(32);
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.CRON_SECRET = 'cron-test-secret';
const {
  assertCronRequest,
  parseJsonBody,
  parseRouteParams,
  parseSearchParams,
  routeErrorResponse,
  withApiRoute,
} = await import('../../src/lib/route-kit.ts');
const { runAction } = await import('../../src/lib/action-state.ts');

const AUTHORED = ['CREDITS_EXHAUSTED', 'PLAN_LIMIT_REACHED', 'SKILL_LIMIT_EXCEEDED'];

test('every error code answers its status, and only authored limit sentences pass through', async () => {
  for (const [code, status] of [
    ['INVALID_BODY', 400],
    ['VALIDATION_FAILED', 400],
    ['UNAUTHENTICATED', 401],
    ['WEBHOOK_SIGNATURE_INVALID', 401],
    ['CREDITS_EXHAUSTED', 402],
    ['FORBIDDEN', 403],
    ['SKILL_LIMIT_EXCEEDED', 403],
    ['WORKSPACE_NOT_FOUND', 404],
    ['SESSION_NOT_FOUND', 404],
    ['SOLE_OWNER_BLOCKED', 409],
    ['CONFLICT', 409],
    ['INTEGRATION_NOT_CONNECTED', 503],
    ['EXTERNAL_API_FAILED', 503],
    ['DATABASE_UNAVAILABLE', undefined],
    ['UNEXPECTED', 500],
  ]) {
    const response = routeErrorResponse(new AppError(code, 'ANTHROPIC_API_KEY internal detail'));
    if (status !== undefined) assert.equal(response.status, status, code);
    const { error } = await response.json();
    assert.equal(error.code, code);
    assert.equal(
      error.message,
      AUTHORED.includes(code) ? 'ANTHROPIC_API_KEY internal detail' : ROUTE_ERROR_MESSAGES[code],
      code,
    );
  }
});

test('a crash answers a generic 500 that never carries its own message, and is logged as an error', async () => {
  routeLogs.length = 0;
  const crash = withApiRoute({ route: 'api/crash' }, async () => {
    throw new Error('secret internals: DB host db.internal');
  });
  const refuse = withApiRoute({ route: 'api/refuse' }, async () => {
    throw new AppError('CREDITS_EXHAUSTED', 'Out of credits', { expectedState: true });
  });
  const response = await crash(new Request('http://test/api'));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: 'UNEXPECTED', message: 'Unexpected error' },
  });
  await refuse(new Request('http://test/api'));
  assert.deepEqual(
    routeLogs
      .filter((entry) => entry.msg === 'route.failed')
      .map(({ route, level }) => ({ route, level })),
    [
      { route: 'api/crash', level: 'error' },
      { route: 'api/refuse', level: 'info' },
    ],
  );
});

test('a server action hides a crash behind its fixed message and keeps an AppError code', async () => {
  const boundary = { route: 'test/action', op: 'test', feature: 'test', message: 'Try again.' };
  const crashed = await runAction(
    { ...boundary, appErrorMessage: () => assert.fail('only AppErrors are rewritten') },
    async () => {
      throw new Error('insert into share (token) values (tok_secret)');
    },
  );
  assert.deepEqual(crashed, { ok: false, code: 'UNEXPECTED', message: 'Try again.' });
  assert.deepEqual(
    await runAction(boundary, async () => {
      throw new AppError('CONFLICT', 'That name is taken', {});
    }),
    { ok: false, code: 'CONFLICT', message: 'That name is taken' },
  );
  assert.deepEqual(await runAction(boundary, async () => 'saved'), { ok: true, data: 'saved' });
});

test('bad input, params or query strings answer 400 as an expected state, never a crash', async () => {
  const Body = z.object({ name: z.string().min(1) });
  const handler = withApiRoute({ route: 'api/parse' }, async (request) =>
    Response.json(await parseJsonBody(request, Body)),
  );
  for (const body of ['{', JSON.stringify({ name: '' }), JSON.stringify({ name: 12 })]) {
    const response = await handler(new Request('http://test/api', { method: 'POST', body }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'INVALID_BODY',
        message: ROUTE_ERROR_MESSAGES.INVALID_BODY,
        expectedState: true,
      },
    });
  }
  const ok = await handler(
    new Request('http://test/api', { method: 'POST', body: '{"name":"ok"}' }),
  );
  assert.deepEqual(await ok.json(), { name: 'ok' });
  const expected = (error) =>
    error instanceof AppError &&
    error.code === 'INVALID_BODY' &&
    error.context.expectedState === true;
  await assert.rejects(
    parseRouteParams(Promise.resolve({ id: '' }), z.object({ id: z.string().min(1) })),
    expected,
  );
  assert.throws(
    () =>
      parseSearchParams(
        new Request('http://test/?limit=many'),
        z.object({ limit: z.coerce.number().int() }),
      ),
    expected,
  );
});

test('a write aimed at another workspace than the one on screen is refused with a reload instruction', async () => {
  assert.doesNotThrow(() => assertExpectedOrganization('org-a', 'org-a'));
  assert.throws(() => assertExpectedOrganization('org-b', ''), { code: 'WORKSPACE_CHANGED' });
  let failure;
  assert.throws(
    () => assertExpectedOrganization('org-b', 'org-a'),
    (error) => {
      failure = error;
      return true;
    },
  );
  const response = routeErrorResponse(failure);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'WORKSPACE_CHANGED',
      message: 'Your workspace changed. Reload before trying again.',
      expectedState: true,
    },
  });
});

test('a credits refusal says when a member limit is the cause, so nobody is offered credits that will not help', async () => {
  const limited = routeErrorResponse(
    new AppError('CREDITS_EXHAUSTED', 'Ask an admin.', { reason: 'member_limit', userId: 'u' }),
  );
  assert.deepEqual(await limited.json(), {
    error: { code: 'CREDITS_EXHAUSTED', message: 'Ask an admin.', reason: 'member_limit' },
  });
  const empty = routeErrorResponse(
    new AppError('CREDITS_EXHAUSTED', 'Add credits.', { reason: 'credits' }),
  );
  assert.equal((await empty.json()).error.reason, undefined);
  const off = routeErrorResponse(new CapabilityOffError('Add EXAMPLE_KEY to turn it on.'));
  assert.equal(off.status, 503);
  assert.equal((await off.json()).error.message, 'Add EXAMPLE_KEY to turn it on.');
});

test('only failures the throw site marks expected stay out of error reporting', () => {
  for (const [error, expected] of [
    [
      new AppError('VALIDATION_FAILED', 'The attached file is empty.', { expectedState: true }),
      true,
    ],
    [new CapabilityOffError('Add EXAMPLE_KEY to turn it on.'), true],
    [new AppError('VALIDATION_FAILED', 'Unknown plan price.'), false],
    [new AppError('EXTERNAL_API_FAILED', 'Storage failed.'), false],
  ]) {
    assert.equal(isExpectedUserStateError(error), expected, error.message);
  }
});

test('a cron route opens only for the exact configured bearer secret', () => {
  const withAuthorization = (authorization) =>
    new Request('http://test/api/cron/job', { headers: { authorization } });
  assert.doesNotThrow(() => assertCronRequest(withAuthorization('Bearer cron-test-secret')));
  for (const request of [
    new Request('http://test/'),
    withAuthorization('Bearer wrong'),
    withAuthorization('Bearer cron-test-secreT'),
    withAuthorization('Bearer cron-test-secret-longer'),
    withAuthorization('cron-test-secret'),
    withAuthorization(''),
  ]) {
    assert.throws(() => assertCronRequest(request), { code: 'UNAUTHENTICATED' });
  }
});
