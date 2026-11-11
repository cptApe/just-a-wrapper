// Live workspace events: private chats reach only their creator, nothing extra is published, and a gap forces a resync.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import {
  audienceForSessionEvent,
  shouldApplySessionTitle,
} from '../../src/features/realtime/lib/channel.ts';
import { reduceStream } from '../../src/features/realtime/lib/stream-machine.ts';
import { workspaceEventSchema } from '../../src/lib/workspace-event.ts';

test('title and status of a private chat go only to its creator; a shared chat goes to the workspace', () => {
  for (const [visibility, audience] of [
    ['private', 'creator'],
    ['workspace', null],
  ]) {
    const scope = { organizationId: 'org', session: { visibility, createdByUserId: 'creator' } };
    for (const event of [
      { type: 'session_title', sessionId: 's', title: 'Secret' },
      { type: 'session_status', sessionId: 's', status: 'running' },
    ])
      assert.equal(audienceForSessionEvent(event, scope), audience, `${visibility} ${event.type}`);
    assert.equal(
      audienceForSessionEvent({ type: 'session_visibility', sessionId: 's', visibility }, scope),
      null,
    );
  }
});

test('a published event keeps only its own fields, and malformed or client-only events are refused', () => {
  assert.deepEqual(
    workspaceEventSchema.parse({ type: 'credits', balance: 42, privateTitle: 'secret' }),
    {
      type: 'credits',
      balance: 42,
    },
  );
  for (const event of [
    { type: 'session_title', sessionId: 'id' },
    { type: 'unknown' },
    { type: 'resync' },
  ])
    assert.equal(workspaceEventSchema.safeParse(event).success, false, event.type);
});

test('switching workspace drops the old cursor and ignores frames from the old connection', () => {
  let state = reduceStream(
    { phase: 'disconnected' },
    { type: 'connect', identity: 'a', attempt: 1 },
  );
  state = reduceStream(state, { type: 'cursor', attempt: 1, cursor: '10' });
  state = reduceStream(state, { type: 'connect', identity: 'b', attempt: 2 });
  assert.equal(state.cursor, '');
  assert.deepEqual(reduceStream(state, { type: 'cursor', attempt: 1, cursor: '11' }), state);
});

test('a generated title never overwrites a rename, but a rename from another tab does', () => {
  const generated = {
    type: 'session_title',
    sessionId: 'chat',
    title: 'Generated',
    previousTitle: 'Opening text',
  };
  assert.equal(shouldApplySessionTitle('Opening text', generated), true);
  assert.equal(shouldApplySessionTitle('My rename', generated), false);
  assert.equal(
    shouldApplySessionTitle('My rename', {
      type: 'session_title',
      sessionId: 'chat',
      title: 'Other tab',
    }),
    true,
  );
});

test('subscribers share one connection, and a gap in event ids makes every subscriber resync', async () => {
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === '@/lib/observability-client')
        return {
          shortCircuit: true,
          url: 'data:text/javascript,export const captureException=console.error;',
        };
      return next(specifier, context);
    },
  });
  const sources = [];
  class Source {
    static OPEN = 1;
    readyState = 0;
    listeners = new Map();
    closed = false;
    constructor(url) {
      this.url = url;
      sources.push(this);
    }
    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }
    close() {
      this.closed = true;
    }
  }
  const original = globalThis.EventSource;
  globalThis.EventSource = Source;
  try {
    const { retainStream } = await import('../../src/features/realtime/lib/stream-store.ts');
    const first = [];
    const second = [];
    const stopFirst = retainStream('org', 'alice', (event) => first.push(event));
    const stopSecond = retainStream('org', 'alice', (event) => second.push(event));
    assert.equal(sources.length, 1);
    sources[0].listeners.get('cursor')({ lastEventId: '123', data: '{}' });
    first.length = 0;
    second.length = 0;
    const event = { type: 'notification', notificationId: 'notice', publishedAt: 1 };
    sources[0].onmessage({ lastEventId: '124', data: JSON.stringify(event) });
    assert.deepEqual([first, second], [[event], [event]]);
    sources[0].listeners.get('cursor')({ lastEventId: '130', data: '{}' });
    assert.equal(first.at(-1).type, 'resync');
    assert.equal(second.at(-1).type, 'resync');
    stopFirst();
    assert.equal(sources[0].closed, false);
    stopSecond();
    assert.equal(sources[0].closed, true);
  } finally {
    globalThis.EventSource = original;
    hooks.deregister();
  }
});
