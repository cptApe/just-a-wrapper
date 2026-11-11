import '../support/env.mjs';
// Unit boundary regressions. Execute the actual handlers with failing feature
// dependencies; API routes schedule telemetry and manual boundaries await it.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const state = { captured: [], flushed: 0, release: null, authorize: false, sent: 0 };
globalThis.__flushTest = state;
const stub = (body) => ({
  url: `data:text/javascript,${encodeURIComponent(body)}`,
  shortCircuit: true,
});
// Only the routes under test get the failing features; the rest of the import graph loads for real.
const fromRoute = (context) => context.parentURL?.includes('/src/app/api/') ?? false;
registerHooks({
  resolve(specifier, context, next) {
    if (
      specifier === '@/lib/observability' ||
      (specifier === './observability' && context.parentURL.endsWith('/src/lib/route-kit.ts'))
    )
      return stub(`
      export const captureException = (...args) => globalThis.__flushTest.captured.push(args);
      export const flushObservability = () => { globalThis.__flushTest.flushed++; return new Promise(resolve => { globalThis.__flushTest.release = resolve; }); };
    `);
    if (specifier === 'next/server')
      return stub('export const after = (job) => globalThis.__afterJobs.push(job);');
    if (specifier === 'next/headers')
      return stub('export const headers = async () => new Headers();');
    if (specifier === '@/features/billing' && fromRoute(context))
      return stub(
        'export const processStripeWebhook = async () => { throw new Error("provider failed"); };',
      );
    if (specifier === '@/features/sessions' && fromRoute(context))
      return stub(`
      export const authorizeSessionAccess = async () => { if (!globalThis.__flushTest.authorize) throw new Error('provider failed'); return { workspaceId: 'workspace', userId: 'user', createdByUserId: 'user', visibility: 'private' }; };
      export { routeErrorResponse as sessionRouteErrorResponse } from '${new URL('../../src/lib/route-kit.ts', import.meta.url).href}';
      export const listSessionEvents = () => [];
      export const authorizeSessionWrite = authorizeSessionAccess;
    `);
    if (specifier === '@/features/session-runtime' && fromRoute(context))
      return stub(`
      export const sendSessionMessage = async () => { globalThis.__flushTest.sent++; return null; };
    `);
    return next(specifier, context);
  },
});
const afterJobs = [];
globalThis.__afterJobs = afterJobs;
const stripe = await import('../../src/app/api/webhooks/stripe/route.ts');
const events = await import('../../src/app/api/sessions/[id]/events/route.ts');
const send = await import('../../src/app/api/sessions/[id]/send/route.ts');
const instrumentation = await import('../../src/instrumentation.ts');
process.env.NEXT_RUNTIME = 'nodejs';
for (const [name, run] of [
  ['stripe', () => stripe.POST(new Request('http://test', { method: 'POST', body: 'raw' }))],
  [
    'events',
    () => events.GET(new Request('http://test'), { params: Promise.resolve({ id: 'session' }) }),
  ],
  [
    'send',
    () => send.POST(new Request('http://test'), { params: Promise.resolve({ id: 'session' }) }),
  ],
  [
    'onRequestError',
    () =>
      instrumentation.onRequestError(
        new Error('render failed'),
        { path: '/', method: 'GET' },
        { routerKind: 'App Router', routePath: '/' },
      ),
  ],
]) {
  test(`${name}: a failure is captured once and its telemetry is flushed before the work ends`, async () => {
    state.captured.length = 0;
    state.flushed = 0;
    state.release = null;
    afterJobs.length = 0;
    let finished = false;
    const pending = run().then((value) => {
      finished = true;
      return value;
    });
    await new Promise(setImmediate);
    assert.equal(state.captured.length, 1);
    let afterPromise;
    if (name !== 'onRequestError') {
      assert.equal(finished, true);
      assert.equal(state.flushed, 0);
      assert.equal(afterJobs.length, 1);
      let flushed = false;
      afterPromise = afterJobs[0]().then(() => {
        flushed = true;
      });
      await new Promise(setImmediate);
      assert.equal(flushed, false);
    } else {
      assert.equal(finished, false);
    }
    assert.equal(state.flushed, 1);
    state.release();
    await afterPromise;
    const response = await pending;
    if (response) assert.equal(response.status, 500);
  });
}

test('a malformed send gets a 400, posts nothing and raises no incident', async () => {
  state.authorize = true;
  const cases = [
    { body: '{', params: { id: 'session' }, code: 'INVALID_BODY' },
    { body: JSON.stringify({ text: '' }), params: { id: 'session' }, code: 'INVALID_BODY' },
    ...[undefined, {}, { id: 12 }].map((params) => ({
      body: JSON.stringify({ text: 'hello' }),
      params,
    })),
  ];
  for (const { body, params, code } of cases) {
    state.sent = 0;
    state.captured.length = 0;
    afterJobs.length = 0;
    const response = await send.POST(new Request('http://test', { method: 'POST', body }), {
      params: Promise.resolve(params),
    });
    const label = `${body} ${JSON.stringify(params)}`;
    assert.equal(response.status, 400, label);
    const { error } = await response.json();
    if (code) assert.equal(error.code, code, label);
    else assert.equal(error.expectedState, true, label);
    assert.equal(state.sent, 0, label);
    assert.equal(state.captured.length, 0, label);
    const flushing = afterJobs[0]();
    state.release();
    await flushing;
  }
});
