// Recovery sweeps: one bad row never stops its peers, a spent deadline leaves work for the next
// run, and a real outage is not mistaken for rows that are merely still pending.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  DurableRecoveryError,
  recoverRows,
  settleRecoveryOperations,
} from '../../src/lib/recover-rows.ts';
import { retryWhile } from '../../src/lib/retry-while.ts';
import {
  assertBeforeDeadline,
  DeadlineReached,
  sweepDeadline,
} from '../../src/lib/sweep-deadline.ts';

test('a failed row lets its peers finish, then reports a durable error with the cause', async () => {
  const visited = [];
  const failure = new Error('row failed');
  await assert.rejects(
    recoverRows(
      [1, 2, 3],
      async (row) => {
        visited.push(row);
        if (row === 2) throw failure;
      },
      { deadline: Date.now() + 10_000 },
    ),
    (error) => error instanceof DurableRecoveryError && error.cause.errors[0] === failure,
  );
  assert.deepEqual(visited, [1, 2, 3]);
});

test('rows run in bounded batches, and a spent deadline stops later batches but not the running one', async () => {
  let running = 0;
  let peak = 0;
  await recoverRows(
    [1, 2, 3, 4, 5, 6, 7],
    async () => {
      running++;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running--;
    },
    { deadline: Date.now() + 10_000, concurrency: 3 },
  );
  assert.equal(peak, 3);

  const visited = [];
  const deadline = Date.now() + 10_000;
  const now = mock.method(Date, 'now', () => deadline - 1);
  try {
    await recoverRows(
      [1, 2, 3],
      async (row) => {
        visited.push(row);
        now.mock.mockImplementation(() => deadline);
      },
      { deadline, concurrency: 2 },
    );
  } finally {
    now.mock.restore();
  }
  assert.deepEqual(visited, [1, 2]);
  await recoverRows([1], () => assert.fail('a row ran past the deadline'), { deadline: 0 });
});

test('independent sweeps all complete; an outage surfaces as an outage, not as pending rows', async () => {
  let completed = false;
  await assert.rejects(
    settleRecoveryOperations([
      Promise.reject(new DurableRecoveryError([new Error('pending row')])),
      Promise.resolve().then(() => {
        completed = true;
      }),
    ]),
    DurableRecoveryError,
  );
  assert.equal(completed, true);
  await assert.rejects(
    settleRecoveryOperations([Promise.reject(new Error('database down'))]),
    (error) => !(error instanceof DurableRecoveryError) && error.code === 'EXTERNAL_API_FAILED',
  );
});

test('a sweep deadline fits the cron limit, and a spent one names the deferred work', () => {
  const deadline = sweepDeadline();
  assert.ok(deadline > Date.now() && deadline - Date.now() <= 240_000);
  assert.throws(
    () => assertBeforeDeadline(0, 'Member cleanup deadline reached', { memberId: 'member_1' }),
    (error) =>
      error instanceof DeadlineReached &&
      error.code === 'DEADLINE_REACHED' &&
      error.context.memberId === 'member_1',
  );
});

test('retries repeat only a retryable failure, and the last failure surfaces once delays run out', async () => {
  const flaky = new Error('try again');
  const fatal = new Error('stop');
  for (const [failures, error, attempts, value] of [
    [[flaky, flaky], null, 3, 'done'],
    [[fatal], fatal, 1, undefined],
    [[flaky, flaky, flaky, flaky], flaky, 3, undefined],
  ]) {
    let count = 0;
    const run = retryWhile(
      async () => {
        const failure = failures[count];
        count += 1;
        if (failure) throw failure;
        return 'done';
      },
      { isRetryable: (cause) => cause === flaky, delays: [0, 0] },
    );
    if (error) await assert.rejects(run, error);
    else assert.equal(await run, value);
    assert.equal(count, attempts);
  }
});
