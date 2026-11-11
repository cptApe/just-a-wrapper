/** The live event stream: a relay failure never wipes the transcript, lost access sends the person to sign in,
 * and a bad frame is reported without its content. Real stream hook and toast; EventSource and React scheduling are faked. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import * as chatState from '../../src/features/chat/lib/chat-state.ts';
import * as chatStreamReducer from '../../src/features/chat/lib/chat-stream-reducer.ts';
import * as connection from '../../src/features/chat/lib/connection-machine.ts';
import * as reducerStore from '../../src/features/chat/lib/reducer-store.ts';
import * as schema from '../../src/features/chat/lib/relay-frame-schema.ts';
import * as errors from '../../src/features/chat/lib/stream-errors.ts';
import * as recovery from '../../src/features/chat/lib/stream-staleness.ts';
import { loadTsx } from '../support/load-tsx.mjs';

const require = createRequire(import.meta.url);
function hooks() {
  const slots = [];
  let cursor = 0;
  let pending = [];
  const react = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      slots[i].set ??= (next) => {
        slots[i].value = typeof next === 'function' ? next(slots[i].value) : next;
      };
      return [slots[i].value, slots[i].set];
    },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((value, j) => value !== slots[i].deps[j]))
        slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useEffectEvent: (fn) => fn,
    useReducer(reducer, initial, init) {
      const [value, set] = react.useState(() => (init ? init(initial) : initial));
      return [value, react.useCallback((action) => set((old) => reducer(old, action)), [])];
    },
    useRef(value) {
      const i = cursor++;
      return (slots[i] ??= { current: value });
    },
    useCallback(callback, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j])) slots[i] = { deps, callback };
      return slots[i].callback;
    },
    useEffect(effect, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j])) {
        pending.push(() => {
          slots[i]?.cleanup?.();
          slots[i] = { deps, cleanup: effect() };
        });
      }
    },
  };
  return {
    react,
    render(fn) {
      cursor = 0;
      const result = fn();
      const effects = pending;
      pending = [];
      effects.forEach((e) => e());
      return result;
    },
    close() {
      slots.forEach((s) => s.cleanup?.());
    },
  };
}
function setup(t) {
  const streamHooks = hooks();
  const toastHooks = hooks();
  const sources = [];
  class Source {
    static CLOSED = 2;
    readyState = 1;
    listeners = new Map();
    constructor() {
      sources.push(this);
    }
    close() {
      this.readyState = 2;
    }
    addEventListener(name, fn) {
      this.listeners.set(name, fn);
    }
    frame(frame) {
      this.listeners.get(frame.type)(new MessageEvent(frame.type, { data: JSON.stringify(frame) }));
    }
  }
  const calls = [];
  const dismissed = [];
  const location = {
    pathname: '/app/task/test',
    assign: (url) => calls.push(url),
    reload: () => calls.push('reload'),
  };
  const previousSource = globalThis.EventSource;
  const previousWindow = globalThis.window;
  globalThis.EventSource = Source;
  globalThis.window = { location };
  t.after(() => {
    if (previousSource === undefined) delete globalThis.EventSource;
    else globalThis.EventSource = previousSource;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const client = {};
  const captured = [];
  const requireStream = (name) => {
    if (name === './use-relay-connection')
      return loadTsx('src/features/chat/hooks/use-relay-connection.ts', requireStream);
    if (name === '../lib/connection-machine') return connection;
    if (name === '../lib/reducer-store') return reducerStore;
    if (name === './use-machine-store')
      return loadTsx('src/features/chat/hooks/use-machine-store.ts', requireStream);
    if (name === 'react') return streamHooks.react;
    if (name === '@tanstack/react-query') return { useQueryClient: () => client };
    if (name === '@/features/sessions/browser') return { applySessionChatEvent() {} };
    if (name === '@/lib/observability-client')
      return { captureException: (...args) => captured.push(args) };
    if (name === '../lib/chat-state') return chatState;
    if (name === '../lib/chat-stream-reducer') return chatStreamReducer;
    if (name === '../lib/decode-relay-frame')
      return loadTsx('src/features/chat/lib/decode-relay-frame.ts', (dependency) => {
        if (dependency === '@/lib/observability-client') return { captureException() {} };
        if (dependency === './relay-frame-schema') return schema;
        throw new Error(dependency);
      });
    if (name === '../lib/stream-staleness') return recovery;
    throw new Error(name);
  };
  const stream = loadTsx(
    'src/features/chat/hooks/use-event-stream.ts',
    requireStream,
  ).useEventStream;
  const Toast = loadTsx('src/features/chat/components/chat-view-stream-error-toast.tsx', (name) => {
    if (name === 'react') return toastHooks.react;
    if (name === 'next/navigation') return { usePathname: () => location.pathname };
    if (name === 'sonner')
      return {
        toast: { error: (...args) => calls.push(args), dismiss: (id) => dismissed.push(id) },
      };
    if (name === '../lib/stream-errors') return errors;
    return require(name);
  }).ChatViewStreamErrorToast;
  const render = () => {
    const state = streamHooks.render(() => stream('test'));
    assert.equal(
      toastHooks.render(() =>
        Toast({ sessionId: 'test', error: state.meta.error, remint: state.remint }),
      ),
      null,
    );
    return state;
  };
  t.after(() => {
    streamHooks.close();
    toastHooks.close();
  });
  render();
  return { render, sources, calls, dismissed, captured };
}

test('a relay failure shows one Retry toast and keeps the transcript through the reconnect', (t) => {
  const h = setup(t);
  h.sources[0].onopen();
  h.sources[0].frame({
    type: 'event',
    event: {
      id: 'message',
      kind: 'message',
      rawType: 'agent.message',
      role: 'assistant',
      text: 'Saved reply',
    },
  });
  h.sources[0].frame({ type: 'history' });
  h.render();
  h.sources[0].frame({ type: 'error', code: 'RELAY_FAILED' });
  const failed = h.render();
  h.render();
  assert.equal(h.calls.length, 1);
  // The server already reported this failure; the browser does not report it again.
  assert.deepEqual(h.captured, []);
  const [, options] = h.calls[0];
  assert.equal(options.action.label, 'Retry');
  let prevented = false;
  options.action.onClick({
    preventDefault() {
      prevented = true;
    },
  });
  assert.ok(prevented);
  h.render();
  assert.equal(h.sources.length, 2);
  h.sources[1].onopen();
  const recovered = h.render();
  assert.deepEqual(recovered.state.items, failed.state.items);
  assert.equal(recovered.meta.error, null);
});

test('lost access sends the person to sign in and back to this task, without reconnecting', (t) => {
  const h = setup(t);
  h.sources[0].frame({ type: 'error', code: 'ACCESS_LOST' });
  h.render();
  const [, options] = h.calls[0];
  options.action.onClick({ preventDefault() {} });
  assert.equal(h.calls[1], '/login?next=%2Fapp%2Ftask%2Ftest');
  assert.equal(h.sources.length, 1);
});

test('a rejected frame is reported by its shape only, never its words', () => {
  const shape = schema.describeRelayFrameShape({
    type: 'event',
    event: { id: 'x', kind: 'browser_control', rawType: 'user.message', text: 'secret words' },
  });
  assert.deepEqual(shape, {
    type: 'event',
    kind: 'browser_control',
    rawType: 'user.message',
    keys: ['type', 'event'],
    eventKeys: ['id', 'kind', 'rawType', 'text'],
  });
  assert.equal(
    JSON.stringify(schema.describeRelayFrameShape({ type: 'meta', traceId: 'T' })).includes('T"'),
    false,
  );
});
