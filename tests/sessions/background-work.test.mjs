// Work after a chat response: one failed step never drops the billing and analytics steps queued after it.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const state = { captures: [], captureThrows: false };
globalThis.__backgroundTest = state;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/server')
      return { shortCircuit: true, url: 'data:text/javascript,export const after = () => {}' };
    if (specifier === '@/lib/observability')
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(`
    export function captureException(error) {
      globalThis.__backgroundTest.captures.push(error);
      if (globalThis.__backgroundTest.captureThrows) throw new Error('Telemetry serialization failed');
    }`)}`,
      };
    return next(specifier, context);
  },
});
const { createBackgroundWork } = await import(
  '../../src/features/sessions/api/create-background-work.ts'
);
const { withRequestContext, snapshotCtx } = await import('../../src/lib/request-context.ts');

for (const captureThrows of [false, true]) {
  test(`a failed billing step does not stop the steps after it (error report throws: ${captureThrows})`, async () => {
    state.captureThrows = captureThrows;
    state.captures = [];
    await withRequestContext({ route: 'test' }, async () => {
      const work = createBackgroundWork(snapshotCtx(), 'session');
      const observed = [];
      work.run('accrue-model-request', async () => {
        observed.push('span:start');
        await new Promise(setImmediate);
        throw new Error('Accrual failed');
      });
      work.run('accrue-usage-reconciliation', () => observed.push('usage'));
      work.run('analytics-turn-complete', () => observed.push('analytics'));
      work.close();
      await work.settled();
      assert.deepEqual(observed, ['span:start', 'usage', 'analytics']);
      assert.equal(state.captures.length, 1);
    });
  });
}

test('the response waits for work that was queued while draining', async () => {
  state.captureThrows = false;
  await withRequestContext({ route: 'test' }, async () => {
    const work = createBackgroundWork(snapshotCtx(), 'session');
    let finished = false;
    const pending = work.settled().then(() => {
      finished = true;
    });
    await new Promise(setImmediate);
    assert.equal(finished, false);
    const observed = [];
    work.run('mirror', async () => {
      await new Promise(setImmediate);
      work.run('late', async () => {
        await new Promise(setImmediate);
        observed.push('late');
      });
    });
    work.close();
    await pending;
    assert.deepEqual(observed, ['late']);
  });
});
