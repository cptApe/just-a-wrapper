/** Unit: toolkit permission reads and writes on a real QueryClient; the server actions are the network edge. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { loadTsx } from '../support/load-tsx.mjs';

const require = createRequire(import.meta.url);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const empty = () => ({ tools: {}, settings: {} });
const change = (toolName, policy) => ({ target: { kind: 'tool', toolName }, policy });

async function setup(actions) {
  const errors = [];
  const toasts = [];
  const resolve = (name) => {
    if (name === '@/lib/observability-client')
      return { captureException: (error, context) => errors.push({ error, context }) };
    if (name === 'sonner') return { toast: { error: (message) => toasts.push(message) } };
    if (name === '@/lib/optimistic-mutation')
      return loadTsx('src/lib/optimistic-mutation.ts', resolve);
    if (name === './tool-policies') return actions;
    if (name === './keys') return require('../../src/features/permissions/api/keys.ts');
    return require(name);
  };
  const { toolkitPermissionsQuery, toolkitPermissionWrites } = loadTsx(
    'src/features/permissions/api/toolkit-permission-queries.ts',
    resolve,
  );
  const client = new QueryClient();
  const observer = new QueryObserver(client, toolkitPermissionsQuery('ws', 'gmail'));
  const unsubscribe = observer.subscribe(() => undefined);
  await tick();
  const writes = toolkitPermissionWrites(client, 'ws', 'gmail');
  const run = (options, variables) =>
    client
      .getMutationCache()
      .build(client, options)
      .execute(variables)
      .then(
        () => 'ok',
        () => 'failed',
      );
  return {
    errors,
    toasts,
    current: () => observer.getCurrentResult(),
    apply: (changes) => run(writes.policies, changes),
    close: () => {
      unsubscribe();
      client.clear();
    },
  };
}

test('after a failed save the Tools page shows the permissions the server kept', async () => {
  let saved = empty();
  const app = await setup({
    getToolkitPermissions: async () => structuredClone(saved),
    setToolPermissions: async () => {
      // A partial write: the UI must trust the read that follows.
      saved = { ...empty(), tools: { first: 'allow' } };
      throw new Error('second target rejected');
    },
  });
  assert.equal(await app.apply([change('first', 'allow'), change('second', 'allow')]), 'failed');
  await tick();
  assert.deepEqual(app.current().data, saved);
  assert.equal(app.errors.length, 1);
  assert.match(app.toasts[0], /saved permissions have been reloaded/);
  app.close();
});

test('a quick allow-then-block reaches the server in that order, so block is what sticks', async () => {
  const first = deferred();
  const order = [];
  const app = await setup({
    getToolkitPermissions: async () => empty(),
    setToolPermissions: async ({ changes }) => {
      order.push(changes[0].policy);
      if (order.length === 1) await first.promise;
      return empty();
    },
  });
  const older = app.apply([change('first', 'allow')]);
  const newer = app.apply([change('first', 'block')]);
  await tick();
  assert.deepEqual(order, ['allow'], 'the newer write waits for the older one');
  assert.equal(app.current().data.tools.first, 'block', 'the newest choice shows at once');
  first.resolve();
  await Promise.all([older, newer]);
  assert.deepEqual(order, ['allow', 'block']);
  app.close();
});

test('an older failed save cannot put back its old permission over a newer choice', async () => {
  const first = deferred();
  let calls = 0;
  let saved = empty();
  const app = await setup({
    getToolkitPermissions: async () => structuredClone(saved),
    setToolPermissions: async () => {
      if (++calls === 1) return first.promise;
      saved = { ...empty(), tools: { first: 'block' } };
      return saved;
    },
  });
  const older = app.apply([change('first', 'allow')]);
  const newer = app.apply([change('first', 'block')]);
  await tick();
  first.reject(new Error('older failure'));
  assert.equal(await older, 'failed');
  assert.equal(app.current().data.tools.first, 'block');
  assert.equal(await newer, 'ok');
  await tick();
  assert.deepEqual(app.current().data, saved);
  app.close();
});
