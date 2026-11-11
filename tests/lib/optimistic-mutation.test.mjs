// Optimistic writes show at once, roll back on failure, and never let an older answer overwrite a
// newer write on screen. Runs on a real QueryClient; only the toast and error report are replaced.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { loadTsx } from '../support/load-tsx.mjs';

const require = createRequire(import.meta.url);
const toasts = [];
const { invalidateUnlessWriting, optimisticMutation } = loadTsx(
  'src/lib/optimistic-mutation.ts',
  (specifier) => {
    if (specifier === 'sonner') return { toast: { error: (message) => toasts.push(message) } };
    if (specifier === '@/lib/observability-client') return { captureException() {} };
    return require(specifier);
  },
);

const ROOT = ['items', 'workspace'];
const LIST = [...ROOT, 'list'];
let client;
beforeEach(() => {
  client = new QueryClient();
  client.setQueryData(LIST, ['a']);
  toasts.length = 0;
});
afterEach(() => client.clear());

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const options = {
  root: ROOT,
  apply: (item) => client.setQueryData(LIST, (old) => [...old, item]),
  failure: () => ({ message: 'Nope', capture: { op: 'test' } }),
};
function start(mutationFn, item) {
  return client
    .getMutationCache()
    .build(client, { ...optimisticMutation(client, options), mutationFn })
    .execute(item)
    .then(
      () => 'ok',
      () => 'failed',
    );
}

test('a write shows before the server answers and rolls back with a toast when it fails', async () => {
  const server = deferred();
  const done = start(() => server.promise, 'b');
  await tick();
  assert.deepEqual(client.getQueryData(LIST), ['a', 'b']);
  server.reject(new Error('boom'));
  assert.equal(await done, 'failed');
  assert.deepEqual(client.getQueryData(LIST), ['a']);
  assert.deepEqual(toasts, ['Nope']);
});

test('an older failure never restores over a newer write, and the newest failure restores its own snapshot', async () => {
  const first = deferred();
  const second = deferred();
  const firstDone = start(() => first.promise, 'b');
  await tick();
  const secondDone = start(() => second.promise, 'c');
  await tick();
  first.reject(new Error('boom'));
  await firstDone;
  assert.deepEqual(client.getQueryData(LIST), ['a', 'b', 'c']);
  second.reject(new Error('boom'));
  await secondDone;
  assert.deepEqual(client.getQueryData(LIST), ['a', 'b']);
});

test('a refetch already in flight cannot overwrite a write, and no refetch starts while writing', async () => {
  const fetched = deferred();
  const refetch = client.fetchQuery({
    queryKey: LIST,
    queryFn: () => fetched.promise,
    staleTime: 0,
  });
  const server = deferred();
  const done = start(() => server.promise, 'b');
  await tick();
  fetched.resolve(['stale']);
  await Promise.allSettled([refetch]);
  await tick();
  assert.deepEqual(client.getQueryData(LIST), ['a', 'b']);

  let invalidations = 0;
  const original = client.invalidateQueries.bind(client);
  client.invalidateQueries = (...args) => {
    invalidations += 1;
    return original(...args);
  };
  invalidateUnlessWriting(client, ROOT);
  assert.equal(invalidations, 0);
  server.resolve();
  await done;
  const afterSettle = invalidations;
  invalidateUnlessWriting(client, ROOT);
  assert.equal(invalidations, afterSettle + 1);
});
