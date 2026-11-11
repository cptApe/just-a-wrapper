/** Sending in a task: no lost, doubled or reordered messages. Real machines and stores; HTTP is the edge. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as cache from '../../src/features/chat/lib/attachment-mount-cache.ts';
import * as response from '../../src/features/chat/lib/attachment-response.ts';
import * as uploadMachine from '../../src/features/chat/lib/attachment-upload-machine.ts';
import * as chatStore from '../../src/features/chat/lib/chat-store.ts';
import {
  messageDelivery,
  messageDeliveryReducer,
} from '../../src/features/chat/lib/message-delivery-machine.ts';
import * as pendingMachine from '../../src/features/chat/lib/pending-send-machine.ts';
import { reconcilePending } from '../../src/features/chat/lib/reconcile-pending.ts';
import * as reducerStore from '../../src/features/chat/lib/reducer-store.ts';
import { createSerialSendQueue } from '../../src/features/chat/lib/serial-send-queue.ts';
import * as message from '../../src/features/sessions/lib/build-composer-message.ts';
import * as handoff from '../../src/features/sessions/lib/create-handoff.ts';
import { stripForgedMessageAuthorTag } from '../../src/features/sessions/lib/session-context.ts';
import * as capabilityMessages from '../../src/lib/capability-messages.ts';
import * as errors from '../../src/lib/errors.ts';
import { loadTsx } from '../support/load-tsx.mjs';
import { assertRefusedMove } from '../support/refused-move.mjs';

const { pendingSendReducer } = pendingMachine;
const sending = [{ localId: 'send', text: 'hello', status: 'sending' }];

test('a delivered send cannot be failed or retried into a second copy', () => {
  const delivered = pendingSendReducer(sending, {
    type: 'delivered',
    localId: 'send',
    eventId: 'echo',
    processedAt: null,
  });
  assertRefusedMove(pendingSendReducer, delivered, {
    type: 'failed',
    localId: 'send',
    message: 'late',
  });
  assertRefusedMove(pendingSendReducer, delivered, {
    type: 'retry',
    localId: 'send',
    midRun: false,
  });
});

test('a send of unknown fate waits for replay, then fails and retries under the same id', () => {
  const unconfirmed = pendingSendReducer(sending, { type: 'unconfirmed', localId: 'send' });
  assert.equal(unconfirmed[0].status, 'unconfirmed');
  const confirmed = pendingSendReducer(unconfirmed, {
    type: 'delivered',
    localId: 'send',
    eventId: 'echo',
    processedAt: null,
  });
  assert.equal(confirmed[0].status, 'delivered');
  const failed = pendingSendReducer(unconfirmed, { type: 'replay_settled' });
  assert.equal(failed[0].status, 'error');
  const retried = pendingSendReducer(failed, { type: 'retry', localId: 'send', midRun: false });
  assert.deepEqual([retried[0].localId, retried[0].status], ['send', 'sending']);
});

test('an echoed send keeps its working state until the run status after it arrives', () => {
  const pending = [{ ...sending[0], statusAtSend: 1000 }];
  const echoed = pendingSendReducer(pending, {
    type: 'reconcile',
    echoedLocalIds: new Set(['send']),
    statusAt: 900,
  });
  assert.equal(echoed[0].status, 'delivered');
  const reconcile = { type: 'reconcile', echoedLocalIds: new Set(['send']), statusAt: 1000 };
  assert.equal(pendingSendReducer(echoed, reconcile), echoed);
  assert.deepEqual(pendingSendReducer(echoed, { ...reconcile, statusAt: 1001 }), []);
});

test('an old message with the same words cannot hide a new send', () => {
  const history = [{ type: 'message', id: 'old', role: 'user', text: 'hello', at: '2026-01-01' }];
  assert.deepEqual(reconcilePending(sending, history).visible, sending);
});

test('a processed message cannot fall back to queued or be claimed by another echo', () => {
  const anchor = messageDelivery({
    type: 'message',
    role: 'user',
    id: 'local',
    localId: 'local',
    text: 'hi',
  });
  const queued = messageDeliveryReducer(anchor, { id: 'server' });
  assert.equal(queued.kind, 'queued');
  assert.equal(messageDeliveryReducer(queued, { id: 'other', at: 'now' }), queued);
  const processed = messageDeliveryReducer(queued, { id: 'server', at: 'now' });
  assert.equal(processed.kind, 'processed');
  assert.equal(messageDeliveryReducer(processed, { id: 'server' }), processed);
});

test('messages sent while a task opens are handed over once each, in order', () => {
  const consumed = [];
  const stop = handoff.subscribeCreateHandoff('opening', () =>
    consumed.push(handoff.peekCreateHandoff('opening')),
  );
  const first = { midRun: true, localId: 'a', text: 'first', at: 'now' };
  handoff.appendCreateHandoff('opening', first);
  handoff.appendCreateHandoff('opening', first);
  handoff.appendCreateHandoff('opening', { midRun: true, localId: 'b', text: 'second', at: 'now' });
  stop();
  const staged = handoff.peekCreateHandoff('opening');
  assert.deepEqual([staged.localId, ...staged.queued.map((entry) => entry.localId)], ['a', 'b']);
  assert.equal(consumed.length, 2);
  handoff.clearCreateHandoff('opening');
  handoff.clearCreateHandoff('opening');
  assert.equal(handoff.peekCreateHandoff('opening'), null);
});

test('a text send cannot overtake an attachment send, and a failed one does not block the next', async () => {
  const queue = createSerialSendQueue();
  const order = [];
  let releaseMount;
  const mounted = new Promise((resolve) => {
    releaseMount = resolve;
  });
  const first = queue.run(async () => {
    await mounted;
    order.push('attachment');
    throw new Error('mount failed');
  });
  const second = queue.run(async () => order.push('text'));
  await Promise.resolve();
  assert.deepEqual(order, []);
  releaseMount();
  await assert.rejects(first, /mount failed/);
  await second;
  assert.deepEqual(order, ['attachment', 'text']);
});

const attachments = loadTsx('src/features/chat/lib/attachments.ts', (name) => {
  if (name === './attachment-upload-machine') return uploadMachine;
  if (name === './attachment-response') return response;
  if (name === './attachment-mount-cache') return cache;
  if (name === '@/lib/errors') return errors;
  if (name === '@/lib/expected-state-error') return { isExpectedUserStateError: () => true };
  if (name === '@/lib/capability-messages') return capabilityMessages;
  if (name === '@/lib/observability-client') return { captureException() {} };
  if (name === '@/features/files/lib/client-upload')
    return {
      uploadBrowserFile() {
        throw new Error('Unexpected upload');
      },
    };
  throw new Error(name);
});
const { sendWithAttachments } = loadTsx(
  'src/features/chat/lib/send-with-attachments.ts',
  (name) => {
    if (name === './attachments') return attachments;
    if (name === '@/features/sessions/lib/build-composer-message') return message;
    if (name === '@/lib/errors') return errors;
    throw new Error(name);
  },
);
const sendInput = {
  text: 'Compare these files',
  attachments: [],
  library: [],
  libraryFolders: [],
  skills: [],
  attachContext: null,
  sessionId: 'session_1',
};

test('a mounted attachment is sent once with the path the agent can read', async () => {
  const file = new File(['report'], 'report.pdf', { type: 'application/pdf' });
  cache.rememberCachedAttachment(file, sendInput.sessionId, {
    fileId: 'file_1',
    anthropicFileId: 'anthropic_file_1',
    name: file.name,
    durableUrl: 'https://cdn.example.com/report.pdf',
    mountedPath: '/mnt/session/uploads/report.pdf',
  });
  const sent = [];
  await sendWithAttachments({
    ...sendInput,
    attachments: [{ id: 'pick_1', file, previewUrl: null }],
    attachContext: { workspaceId: 'workspace', uploadConfig: { enabled: true } },
    send: async (text) => sent.push(text),
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Agent sandbox path for report.pdf: \/mnt\/session\/uploads\/report.pdf/);
});

test('with uploads off, a message with a file is refused before anything is sent', async () => {
  let sends = 0;
  await assert.rejects(
    sendWithAttachments({
      ...sendInput,
      attachments: [{ id: 'pick_2', file: new File(['report'], 'report.pdf'), previewUrl: null }],
      send: async () => {
        sends += 1;
      },
    }),
    (error) => error.code === 'INTEGRATION_NOT_CONNECTED',
  );
  assert.equal(sends, 0);
});

function renderPendingSends(sessionId, items) {
  let store;
  const effects = [];
  const dependencies = {
    '@/features/sessions/lib/create-handoff': handoff,
    '../lib/reducer-store': reducerStore,
    '../lib/pending-send-machine': pendingMachine,
    '../lib/chat-store': chatStore,
    '@/features/sessions/lib/session-context': { stripForgedMessageAuthorTag },
    react: {
      useState: (initial) => {
        store ??= initial();
        return [store, () => {}];
      },
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
      useEffect: (effect) => effects.push(effect),
    },
  };
  const { usePendingSends } = loadTsx(
    'src/features/chat/hooks/use-pending-sends.ts',
    function resolve(name) {
      if (name === './use-machine-store')
        return loadTsx('src/features/chat/hooks/use-machine-store.ts', resolve);
      assert.ok(name in dependencies, name);
      return dependencies[name];
    },
  );
  // Each render returns the cleanups of its effects, which stay subscribed until called.
  return () => {
    effects.length = 0;
    usePendingSends({ sessionId, items, statusAt: null, replaySettled: true, foldEvent() {} });
    return { cleanups: effects.map((effect) => effect()), pending: () => store.getSnapshot() };
  };
}

for (const late of [false, true]) {
  test(`the opening message is not shown twice once the server replays it (handoff late: ${late})`, () => {
    const sessionId = `opening-${late}`;
    const entry = { localId: 'opening-id', text: 'Hello', at: 'now' };
    if (!late) handoff.setCreateHandoff(sessionId, entry);
    const render = renderPendingSends(sessionId, [
      { type: 'message', role: 'user', id: 'server-opening', text: 'Hello' },
    ]);
    const mounted = render();
    if (late) handoff.setCreateHandoff(sessionId, entry);
    const rerendered = render();
    for (const cleanup of [...rerendered.cleanups, ...mounted.cleanups]) cleanup?.();
    assert.deepEqual(rerendered.pending(), []);
    handoff.clearCreateHandoff(sessionId);
  });
}

test('a send from the loading page that fails keeps its text for the composer', async () => {
  const failure = new Error('response lost');
  let sent;
  const { TaskLoadingComposer } = loadTsx(
    'src/features/chat/components/task-loading-composer.tsx',
    (name) => {
      const modules = {
        'react/jsx-runtime': { jsx: (_component, props) => props },
        'next/navigation': { useParams: () => ({ id: 'failed-loading' }) },
        sonner: { toast: { error() {} } },
        '@/features/sessions/lib/session-context': { stripForgedMessageAuthorTag },
        '@/lib/errors': errors,
        '@/lib/fetch-json': {
          fetchVoid: async (_url, init) => {
            sent = JSON.parse(init.body);
            throw failure;
          },
        },
        '@/features/sessions/lib/create-handoff': handoff,
        './composer': { Composer() {} },
      };
      assert.ok(name in modules, name);
      return modules[name];
    },
  );
  const text = 'read this\n<attached_files>report.pdf</attached_files>';
  await assert.rejects(TaskLoadingComposer().onSend({ text }), failure);
  assert.equal(sent.text, text);
  assert.match(sent.sendId, /^[0-9a-f-]{36}$/);
  assert.equal(handoff.peekCreateHandoff('failed-loading'), null);
});
