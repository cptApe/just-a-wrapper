/** Home's real send handlers: no lost drafts, no deleted delivered tasks, no doubles. Task creation and HTTP are the edge. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as cache from '../../src/features/chat/lib/attachment-mount-cache.ts';
import * as response from '../../src/features/chat/lib/attachment-response.ts';
import * as uploadMachine from '../../src/features/chat/lib/attachment-upload-machine.ts';
import * as failure from '../../src/features/chat/lib/classify-send-failure.ts';
import * as composerSubmission from '../../src/features/chat/lib/composer-submission.ts';
import { reduceHomeOpening } from '../../src/features/chat/lib/home-opening-machine.ts';
import { createReducerStore } from '../../src/features/chat/lib/reducer-store.ts';
import * as message from '../../src/features/sessions/lib/build-composer-message.ts';
import * as handoff from '../../src/features/sessions/lib/create-handoff.ts';
import { stripForgedMessageAuthorTag } from '../../src/features/sessions/lib/session-context.ts';
import * as capabilityMessages from '../../src/lib/capability-messages.ts';
import * as errors from '../../src/lib/errors.ts';
import { loadDraftStore } from '../support/draft-store.mjs';
import { loadTsx } from '../support/load-tsx.mjs';

const drafts = loadDraftStore();
const workspaceState = loadTsx('src/features/chat/lib/workspace-client-state.ts', (name) => {
  if (name === './draft-store') return drafts;
  if (name === './composer-banner-store')
    return { getComposerBanners: () => [], dismissComposerBanner() {} };
  throw new Error(name);
});
const takeHome = () => drafts.takeComposerDraft(drafts.HOME_DRAFT_KEY);

const attachments = loadTsx('src/features/chat/lib/attachments.ts', (name) => {
  if (name === './attachment-upload-machine') return uploadMachine;
  if (name === './attachment-mount-cache') return cache;
  if (name === './attachment-response') return response;
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
const sending = loadTsx('src/features/chat/lib/send-with-attachments.ts', (name) => {
  if (name === './attachments') return attachments;
  if (name === '@/features/sessions/lib/build-composer-message') return message;
  if (name === '@/lib/errors') return errors;
  throw new Error(name);
});

function surface(
  t,
  { createError, sendError, deleteError, attach = null, finishError, createDeferred } = {},
) {
  const calls = [];
  const bodies = [];
  const current = {};
  const machine = createReducerStore({ kind: 'idle' }, reduceHomeOpening);
  takeHome();
  drafts.takeComposerDraft(drafts.OPENING_DRAFT_KEY);
  handoff.clearCreateHandoff('session');
  const setter = (key) => (value) => {
    if (key === 'sessions' && finishError) throw finishError;
    current[key] = typeof value === 'function' ? value(current[key]) : value;
  };
  const ref = (value) => ({ current: value });
  const location = { pathname: '/app' };
  const priorWindow = globalThis.window;
  t.after(() => {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  });
  globalThis.window = {
    location,
    history: {
      pushState(_state, _title, path) {
        location.pathname = path;
      },
      replaceState(_state, _title, path) {
        location.pathname = path;
      },
    },
  };
  const dependencies = {
    sonner: { toast: { error: (text) => calls.push(['toast', text]) } },
    '@/features/sessions/lib/session-context': { stripForgedMessageAuthorTag },
    '@/features/sessions/browser': { runWithSessionActivity: (_cache, _id, action) => action() },
    '@/features/sessions/lib/untitled-session-title': { UNTITLED_SESSION_TITLE: 'Untitled task' },
    '@/lib/errors': errors,
    '@/lib/fetch-json': {
      fetchVoid: async (url, init) => {
        calls.push([init.method, url]);
        if (init.body) bodies.push(JSON.parse(init.body));
        if (init.method === 'POST' && sendError) throw sendError;
        if (init.method === 'DELETE' && deleteError) throw deleteError;
      },
    },
    '@/lib/capability-messages': capabilityMessages,
    '@/lib/observability-client': { captureException: (error) => calls.push(['error', error]) },
    '../lib/attachment-mount-cache': cache,
    '@/features/sessions/lib/build-composer-message': message,
    '../lib/classify-send-failure': failure,
    '../lib/send-failure-banner': loadTsx(
      'src/features/chat/lib/send-failure-banner.ts',
      (name) => {
        if (name === '@/components/icons') return { IconCreditCard01() {}, IconZap() {} };
        if (name === '@/features/overlays/lib/overlay-history')
          return { openOverlay: (hash) => calls.push(['overlay', hash]) };
        if (name === './composer-banner-store')
          return {
            CREDITS_EXHAUSTED_BANNER_ID: 'credits-exhausted',
            dismissComposerBanner() {},
            registerComposerBanner(banner) {
              calls.push(['banner', banner]);
            },
          };
        throw new Error(name);
      },
    ),
    '@/features/sessions/lib/create-handoff': handoff,
    '@/components/providers/deployment-capabilities-provider': { usePlansForSale: () => false },
    '../lib/draft-store': drafts,
    '../lib/workspace-client-state': workspaceState,
    '../lib/send-with-attachments': sending,
  };
  const { useHomeSend: renderHook } = loadTsx(
    'src/features/chat/hooks/use-home-send.ts',
    (name) => {
      assert.ok(name in dependencies, name);
      return dependencies[name];
    },
  );
  const handlers = renderHook({
    opening: machine,
    lifetime: ref(new AbortController()),
    openingSessionIdRef: ref(null),
    setOpeningSessionId: setter('id'),
    queuedRef: ref([]),
    setQueued: setter('queued'),
    setCreateError: setter('error'),
    ownAttachmentPreviews() {},
    setPendingAttachments: setter('attachments'),
    setPending: setter('pending'),
    pendingComposerRef: ref(null),
    mountedRef: ref(true),
    setOpenedSessions: setter('sessions'),
    tier: 'default',
    viewer: { id: 'viewer', name: 'Name', email: 'name@example.com', image: null },
    createSession: {
      mutateAsync: async (input) => {
        calls.push(['create', input]);
        if (createDeferred) await createDeferred;
        if (createError) throw createError;
        return { sessionId: 'session' };
      },
    },
    queryClient: {},
    attach,
    createPromiseRef: ref(null),
    sendChainRef: ref(Promise.resolve()),
    queuedIdRef: ref(0),
  });
  return { handlers, calls, bodies, current, location, machine };
}
const emptyDraft = { text: '', attachments: [], library: [], folders: [], skills: [] };
/** What the composer hands onSend for a draft. */
function submission(draft) {
  const full = { ...emptyDraft, ...draft };
  return {
    draft: full,
    text: full.text.trim() || composerSubmission.ATTACHMENTS_ONLY_MESSAGE,
    optimisticAttachments: [],
    claimAttachmentPreviews() {},
  };
}
const textSubmission = submission({ text: 'Write a brief' });

test('a Home send creates one task and hands its message to the task page', async (t) => {
  const state = surface(t);
  await state.handlers.onSend(textSubmission);
  assert.equal(state.calls.filter((call) => call[0] === 'create').length, 1);
  assert.equal(state.calls.find((call) => call[0] === 'create')[1].deferMessage, false);
  assert.equal(handoff.peekCreateHandoff('session').text, textSubmission.text);
  assert.equal(state.location.pathname, '/app/task/session');
  assert.equal(state.current.sessions.session.status, 'running');
});

test('a file that cannot be prepared deletes the empty task and gives back the draft', async (t) => {
  const state = surface(t);
  const file = new File(['report'], 'report.pdf');
  await state.handlers.onSend(
    submission({
      text: textSubmission.text,
      attachments: [{ id: 'file', file, previewUrl: null }],
    }),
  );
  assert.equal(
    state.calls.some((call) => call[0] === 'DELETE'),
    true,
  );
  const restored = takeHome();
  assert.equal(restored.text, textSubmission.text);
  assert.deepEqual(
    restored.attachments.map((item) => item.file),
    [file],
  );
  assert.equal(state.location.pathname, '/app');
  assert.equal(state.machine.getSnapshot().kind, 'failed');
});

for (const deleteFails of [false, true]) {
  test(`an out-of-credits first send keeps the draft and the Add credits banner (cleanup fails: ${deleteFails})`, async (t) => {
    const sendError = new errors.AppError('API_REQUEST_FAILED', 'No credits', {
      status: 402,
      serverCode: 'CREDITS_EXHAUSTED',
      expectedState: true,
    });
    const state = surface(t, {
      sendError,
      deleteError: deleteFails ? new Error('delete unavailable') : undefined,
      attach: { workspaceId: 'workspace', uploadConfig: { enabled: true } },
    });
    const file = new File(['report'], 'report.pdf');
    cache.rememberCachedAttachment(file, 'session', {
      fileId: 'file',
      anthropicFileId: 'upstream-file',
      name: 'report.pdf',
      durableUrl: 'https://example.com/report.pdf',
      mountedPath: '/mnt/report.pdf',
    });
    await state.handlers.onSend(
      submission({
        text: textSubmission.text,
        attachments: [{ id: 'file', file, previewUrl: null }],
      }),
    );
    assert.ok(state.calls.some(([method]) => method === 'POST'));
    assert.equal(
      state.calls.some(([method]) => method === 'DELETE'),
      true,
    );
    const banner = state.calls.find(([kind]) => kind === 'banner')[1];
    assert.equal(banner.id, 'credits-exhausted');
    banner.action.onSelect();
    assert.deepEqual(state.calls.at(-1), ['overlay', 'topup']);
    const restored = takeHome();
    assert.equal(restored.text, textSubmission.text);
    assert.deepEqual(
      restored.attachments.map((item) => item.file),
      [file],
    );
  });
}

test('a failure after the message was delivered never deletes the task', async (t) => {
  const state = surface(t, {
    finishError: new Error('view update failed'),
    attach: { workspaceId: 'workspace', uploadConfig: { enabled: true } },
  });
  const file = new File(['report'], 'report.pdf');
  cache.rememberCachedAttachment(file, 'session', {
    fileId: 'delivered',
    anthropicFileId: 'upstream-file',
    name: 'report.pdf',
    durableUrl: 'https://example.com/report.pdf',
    mountedPath: '/mnt/report.pdf',
  });
  await state.handlers.onSend(
    submission({
      text: textSubmission.text,
      attachments: [{ id: 'file', file, previewUrl: null }],
    }),
  );
  assert.ok(state.calls.some(([method]) => method === 'POST'));
  assert.equal(
    state.calls.some(([method]) => method === 'DELETE'),
    false,
  );
});

for (const text of ['typed words', '']) {
  test(`a failed create gives back the typed text and every pick: ${JSON.stringify(text)}`, async (t) => {
    const state = surface(t, { createError: new Error('create failed') });
    const library = [
      { id: 'pick', name: 'report', path: '/report', url: 'https://example.com/report' },
    ];
    const skills = [{ id: 'skill', name: 'Write', description: '' }];
    await state.handlers.onSend(submission({ text, library, skills }));
    const recovered = takeHome();
    assert.equal(recovered.text, text);
    assert.deepEqual(recovered.library, library);
    assert.deepEqual(recovered.skills, skills);
  });
}

for (const status of [undefined, 503, 400]) {
  test(`a failed first send deletes the task only when the server surely refused it: ${status}`, async (t) => {
    const state = surface(t, {
      sendError: new errors.AppError('API_REQUEST_FAILED', 'failed', { status }),
      attach: { workspaceId: 'workspace', uploadConfig: { enabled: true } },
    });
    const file = new File(['report'], 'report.pdf');
    cache.rememberCachedAttachment(file, 'session', {
      fileId: 'file',
      anthropicFileId: 'remote',
      name: 'report.pdf',
      durableUrl: 'https://example.com/report',
      mountedPath: '/mnt/report',
    });
    await state.handlers.onSend(
      submission({
        text: textSubmission.text,
        attachments: [{ id: 'file', file, status: 'local', previewUrl: null }],
      }),
    );
    assert.equal(
      state.calls.some(([method]) => method === 'DELETE'),
      status === 400,
    );
  });
}
test('a second send while one opening runs is refused, not sent as another task', async (t) => {
  const state = surface(t);
  state.machine.dispatch({ type: 'start', attempt: Symbol(), text: 'first', attachments: [] });
  await assert.rejects(state.handlers.onSend(textSubmission), (error) => error.code === 'CONFLICT');
});

test('the first message and its handoff share one send id, so it cannot show twice', async (t) => {
  const state = surface(t, {
    attach: { workspaceId: 'workspace', uploadConfig: { enabled: true } },
  });
  const file = new File(['report'], 'report.pdf');
  cache.rememberCachedAttachment(file, 'session', {
    fileId: 'file',
    anthropicFileId: 'remote',
    name: 'report.pdf',
    durableUrl: 'https://example.com/report',
    mountedPath: '/mnt/report',
  });
  await state.handlers.onSend(
    submission({
      text: textSubmission.text,
      attachments: [{ id: 'file', file, status: 'local', previewUrl: null }],
    }),
  );
  const body = state.bodies.at(-1);
  assert.match(
    body.sendId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(handoff.peekCreateHandoff('session').localId, body.sendId);
  assert.equal(handoff.peekCreateHandoff('session').text, body.text);
});

test('a failed opening from another workspace never restores its draft here', async (t) => {
  let fail;
  const createDeferred = new Promise((_resolve, reject) => {
    fail = reject;
  });
  const view = surface(t, { createDeferred });
  const pending = view.handlers.onSend(textSubmission);
  workspaceState.resetWorkspaceClientState();
  fail(new Error('earlier workspace request failed'));
  await pending;
  assert.deepEqual(takeHome(), emptyDraft);
  assert.equal(
    view.calls.some(([kind]) => kind === 'banner' || kind === 'toast'),
    false,
  );
});

test('words typed while the task opened move to the new task', async (t) => {
  const state = surface(t);
  await state.handlers.onSend({
    ...textSubmission,
    // The opening composer is typed into while the create runs.
    claimAttachmentPreviews() {
      drafts.setComposerText(drafts.OPENING_DRAFT_KEY, 'and a follow-up');
    },
  });
  assert.equal(drafts.readComposerDraft('session').text, 'and a follow-up');
  assert.equal(drafts.readComposerDraft(drafts.OPENING_DRAFT_KEY).text, '');
  drafts.discardDraft('session');
});

test('a failed opening gives back the sent draft first, then what was typed meanwhile', async (t) => {
  const state = surface(t, { createError: new Error('create failed') });
  await state.handlers.onSend({
    ...textSubmission,
    claimAttachmentPreviews() {
      drafts.setComposerText(drafts.OPENING_DRAFT_KEY, 'typed meanwhile');
    },
  });
  assert.equal(takeHome().text, `${textSubmission.text}\n\ntyped meanwhile`);
});
