// Charging usage survives a dropped database socket and never fails a webhook over a cost it
// cannot read. Exact-once charging runs on real Postgres in tests/integration/metering-*.test.ts.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  ACCRUAL_RETRY_DELAYS_MS,
  accrualRetryDelays,
  isTransientDatabaseError,
  retryTransientAccrual,
} from '@/features/billing/api/accrue-retry';
import { BillingError } from '@/lib/errors';
import { loadTsx } from '../support/load-tsx.mjs';

// The Neon driver hands a waiting query the socket's own ErrorEvent, not an Error.
class ErrorEvent extends Event {
  constructor(message, error) {
    super('error');
    this.message = message;
    this.error = error;
  }
}
// Drizzle wraps every failed query with the driver failure as `cause`.
const queryFailure = (cause) => new Error('Failed query: insert into usage_event', { cause });

// Run the real retry policy with Node's timer clock advanced by hand.
async function withoutWaiting(run) {
  mock.timers.enable({ apis: ['setTimeout'] });
  const jitter = mock.method(Math, 'random', () => 0);
  let settled = false;
  const outcome = run()
    .finally(() => {
      settled = true;
    })
    .then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
  try {
    while (!settled) {
      await new Promise(setImmediate);
      mock.timers.runAll();
    }
    const result = await outcome;
    if ('error' in result) throw result.error;
    return result.value;
  } finally {
    mock.timers.reset();
    jitter.mock.restore();
  }
}

test('connection drops, deadlocks and serialization failures are retried; real errors are not', () => {
  for (const failure of [
    queryFailure(new ErrorEvent('Received network error or non-101 status code.', new Error('x'))),
    new ErrorEvent('socket closed', null),
    { type: 'error', error: new Error('x'), message: 'x' },
    queryFailure(new Error('SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce is too short')),
    queryFailure(new Error('Connection terminated unexpectedly')),
    ...['40P01', '40001', '08006', '57P01', 'ECONNRESET'].map((code) =>
      queryFailure(Object.assign(new Error(code), { code })),
    ),
  ]) {
    assert.equal(isTransientDatabaseError(failure), true, String(failure.message ?? failure.type));
  }
  for (const failure of [
    { type: 'close', code: 1006 },
    queryFailure(Object.assign(new Error('unique'), { code: '23505' })),
    Object.create(null),
    { constructor: null },
  ]) {
    assert.equal(isTransientDatabaseError(failure), false);
  }
});

test('a charge whose socket dropped is written on the next attempt', async () => {
  let attempts = 0;
  const result = await withoutWaiting(() =>
    retryTransientAccrual(
      async () => {
        attempts += 1;
        if (attempts === 1) throw queryFailure(new ErrorEvent('reset', new Error('reset')));
        return 'billed';
      },
      { anthropicSessionId: 'asess_retry' },
    ),
  );
  assert.equal(result, 'billed');
  assert.equal(attempts, 2);
});

test('a non-transient failure is thrown at once, and an exhausted schedule keeps its cause', async () => {
  const known = new BillingError('SESSION_NOT_FOUND', 'no session', { toolUseId: 't1' });
  let attempts = 0;
  await assert.rejects(
    withoutWaiting(() =>
      retryTransientAccrual(
        async () => {
          attempts += 1;
          throw known;
        },
        { anthropicSessionId: 'asess_known' },
      ),
    ),
    (error) => error === known,
  );
  assert.equal(attempts, 1);

  const deadlock = queryFailure(Object.assign(new Error('deadlock'), { code: '40P01' }));
  attempts = 0;
  await assert.rejects(
    withoutWaiting(() =>
      retryTransientAccrual(
        async () => {
          attempts += 1;
          throw deadlock;
        },
        { anthropicSessionId: 'asess_exhausted', toolUseId: 'tool_exhausted' },
      ),
    ),
    (error) =>
      error instanceof BillingError &&
      error.code === 'UNEXPECTED' &&
      error.cause === deadlock &&
      error.context.attemptCount === ACCRUAL_RETRY_DELAYS_MS.length + 1,
  );
  assert.equal(attempts, ACCRUAL_RETRY_DELAYS_MS.length + 1);
});

test('retry waits grow and stretch by at most a quarter of themselves', () => {
  for (const [random, delays] of [
    [0, [250, 1_000, 3_000]],
    [0.999, [312, 1_249, 3_749]],
  ]) {
    const jitter = mock.method(Math, 'random', () => random);
    try {
      assert.deepEqual(accrualRetryDelays(), delays);
    } finally {
      jitter.mock.restore();
    }
  }
});

test('a usage snapshot in an unsupported currency is logged once and the webhook still succeeds', async () => {
  const logs = [];
  const { accrueSessionUsageEvent } = loadTsx(
    'src/features/billing/api/accrue-session-usage-event.ts',
    () => ({ shipLog: (entry) => logs.push(entry) }),
  );
  await accrueSessionUsageEvent('session', {
    type: 'session.usage',
    id: 'snapshot',
    processed_at: new Date().toISOString(),
    usage: { list_cost: { amount: '10', currency: 'EUR' } },
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].currency, 'EUR');
});
