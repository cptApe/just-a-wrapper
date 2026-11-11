/** The composer never sends twice, never loses a draft and never carries one across workspaces. Real reducers and stores. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reduceAttachmentUpload } from '../../src/features/chat/lib/attachment-upload-machine.ts';
import { partitionComposerFiles } from '../../src/features/chat/lib/attachment-validation.ts';
import * as banners from '../../src/features/chat/lib/composer-banner-store.ts';
import {
  draftHasContent,
  EMPTY_COMPOSER_DRAFT,
  reduceComposerDraft,
} from '../../src/features/chat/lib/composer-draft.ts';
import { composerStatus } from '../../src/features/chat/lib/composer-status.ts';
import { reduceComposerSubmit } from '../../src/features/chat/lib/composer-submit-machine.ts';
import {
  INLINE_LIMIT_NOTICE,
  MAX_INLINE_TEXT_CHARS,
  MAX_MESSAGE_CHARS,
} from '../../src/features/chat/lib/message-limit.ts';
import { createReducerStore } from '../../src/features/chat/lib/reducer-store.ts';
import { buildComposerMessage } from '../../src/features/sessions/lib/build-composer-message.ts';
import { loadDraftStore } from '../support/draft-store.mjs';
import { loadTsx } from '../support/load-tsx.mjs';

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
};
const PREFIX = 'just-a-wrapper:draft:';
const settle = () => new Promise((resolve) => queueMicrotask(resolve));
const file = (name) => new File(['x'], name, { type: 'text/plain' });
const attachment = (id, status = 'ready', extra = {}) => ({
  id,
  file: file(`${id}.txt`),
  previewUrl: null,
  status,
  ...(status === 'ready' ? { prepared: { id } } : {}),
  ...(status === 'failed' ? { error: 'no' } : {}),
  ...extra,
});
const libraryFile = (id) => ({
  id,
  name: id,
  url: `/f/${id}`,
  mimeType: 'text/plain',
  sizeBytes: 1,
});
const draft = (overrides = {}) => ({ ...EMPTY_COMPOSER_DRAFT, ...overrides });

const ready = { kind: 'ready', creditBalance: 10, hasPlan: true };
const status = (overrides = {}) =>
  composerStatus({
    draft: draft({ text: 'hi' }),
    attach: { workspaceId: 'w', uploadConfig: { enabled: true } },
    credits: ready,
    paused: false,
    streaming: false,
    stopping: false,
    ...overrides,
  });

test('send is held without credits, while paused or stopping, and while a file uploads or failed', () => {
  assert.equal(status().canSubmit, true);
  assert.equal(status({ credits: { kind: 'off' } }).canSubmit, true);
  for (const blocked of [
    { draft: EMPTY_COMPOSER_DRAFT },
    { credits: { ...ready, creditBalance: 0 } },
    { credits: { kind: 'loading' } },
    { paused: true },
    { stopping: true },
  ])
    assert.equal(status(blocked).canSubmit, false, JSON.stringify(blocked));
  for (const upload of ['uploading', 'failed'])
    assert.equal(
      status({ draft: draft({ attachments: [attachment('a', upload)] }) }).uploadGate,
      upload,
    );
  assert.equal(status({ streaming: true }).mode, 'send');
  assert.equal(status({ streaming: true, draft: EMPTY_COMPOSER_DRAFT }).mode, 'stop');
});

test('long text without uploads is refused before sending, and file references never push a message over the limit', () => {
  const long = draft({ text: 'a'.repeat(MAX_INLINE_TEXT_CHARS + 1) });
  assert.equal(status({ draft: long, attach: null }).messageLimitNotice, INLINE_LIMIT_NOTICE);
  assert.equal(status({ draft: long, attach: null }).canSubmit, false);
  assert.equal(status({ draft: long }).messageLimitNotice, null);
  const files = Array.from({ length: 100 }, (_, index) => ({
    name: `file-${index}.txt`,
    durableUrl: `/api/files/${index}/content`,
    mountedPath: `/mnt/session/uploads/file-${index}.txt`,
  }));
  const message = buildComposerMessage(
    'a'.repeat(MAX_INLINE_TEXT_CHARS),
    [],
    [],
    [{ id: 's', name: 'Research' }],
    files,
  );
  assert.ok(message.length <= MAX_MESSAGE_CHARS);
});

test('one send runs at a time, and emptying an armed composer cancels its send', () => {
  for (const gate of ['ready', 'uploading', 'failed']) {
    const attempt = Symbol();
    const store = createReducerStore({ kind: 'idle' }, reduceComposerSubmit);
    assert.equal(store.dispatch({ type: 'request', canSubmit: false, gate, attempt }), false);
    store.dispatch({ type: 'request', canSubmit: true, gate, attempt });
    if (gate !== 'ready') store.dispatch({ type: 'ready', canSubmit: true, attempt });
    assert.equal(store.getSnapshot().kind, 'submitting');
    assert.equal(
      store.dispatch({ type: 'request', canSubmit: true, gate, attempt: Symbol() }),
      false,
    );
    assert.equal(store.dispatch({ type: 'settled', attempt: Symbol() }), false);
    store.dispatch({ type: 'settled', attempt });
    assert.equal(store.getSnapshot().kind, 'idle');
  }
  const store = createReducerStore({ kind: 'idle' }, reduceComposerSubmit);
  const attempt = Symbol();
  store.dispatch({ type: 'request', canSubmit: true, gate: 'uploading', attempt });
  store.dispatch({ type: 'emptied' });
  assert.equal(store.dispatch({ type: 'ready', canSubmit: true, attempt }), false);
  assert.equal(store.getSnapshot().kind, 'idle');
});

test('an upload settles only while uploading, so a finished or failed file cannot flip back', () => {
  const local = attachment('pick', 'local');
  assert.equal(reduceAttachmentUpload(local, { type: 'ready', prepared: {} }), local);
  assert.equal(reduceAttachmentUpload(local, { type: 'failed', error: 'late' }), local);
  const uploading = reduceAttachmentUpload(local, { type: 'start' });
  const done = reduceAttachmentUpload(uploading, { type: 'ready', prepared: {} });
  assert.equal(done.status, 'ready');
  assert.equal(reduceAttachmentUpload(done, { type: 'start' }), done);
  const failed = reduceAttachmentUpload(uploading, { type: 'failed', error: 'network' });
  assert.equal(reduceAttachmentUpload(failed, { type: 'ready', prepared: {} }), failed);
  assert.equal(
    reduceAttachmentUpload(reduceAttachmentUpload(failed, { type: 'start' }), { type: 'interrupt' })
      .status,
    'local',
  );
});

test('empty files are refused, and skills alone are not a message', () => {
  const empty = new File([], 'empty.txt');
  const full = file('full.txt');
  assert.deepEqual(partitionComposerFiles([empty, full]), { empty: [empty], attachable: [full] });
  assert.equal(draftHasContent(draft({ text: '   ' })), false);
  assert.equal(
    draftHasContent(draft({ skills: [{ id: 's', name: 's', description: null }] })),
    false,
  );
  assert.equal(draftHasContent(draft({ library: [libraryFile('a')] })), true);
});

test('an upload that finishes after its file left the draft changes nothing', () => {
  const start = draft({ attachments: [attachment('a', 'uploading')] });
  assert.equal(
    reduceComposerDraft(start, { type: 'attachment', attachment: attachment('gone') }),
    start,
  );
});

test('a failed send comes back first, with its uploads restarted, and no file twice', () => {
  const current = draft({
    text: 'typed since',
    attachments: [attachment('new', 'local')],
    library: [libraryFile('b')],
  });
  const failed = draft({
    text: 'sent',
    attachments: [
      attachment('up', 'uploading', { previewUrl: 'blob:old' }),
      attachment('new', 'local'),
    ],
    library: [libraryFile('a'), libraryFile('b')],
  });
  const next = reduceComposerDraft(current, { type: 'restore', draft: failed });
  assert.equal(next.text, 'sent\n\ntyped since');
  assert.deepEqual(
    next.attachments.map((item) => [item.id, item.status, item.previewUrl]),
    [
      ['up', 'local', null],
      ['new', 'local', null],
    ],
  );
  assert.deepEqual(
    next.library.map((pick) => pick.id),
    ['a', 'b'],
  );
});

test("a task's draft text survives a reload; Home's private drafts never reach storage", () => {
  const first = loadDraftStore();
  first.setComposerText('task-a', 'Hello there', { start: 2, end: 5 });
  first.setComposerText(first.HOME_DRAFT_KEY, 'private');
  first.setComposerText(first.OPENING_DRAFT_KEY, 'also private');
  const reloaded = loadDraftStore();
  assert.equal(reloaded.readComposerDraft('task-a').text, 'Hello there');
  assert.deepEqual(reloaded.readDraftCursor('task-a'), { start: 2, end: 5 });
  assert.deepEqual([...storage.keys()], [`${PREFIX}task-a`]);
  reloaded.discardDraft('task-a');
  assert.equal(storage.size, 0);
});

test('a failed send restores into the store even with no composer open, and repeated failures pile up', async () => {
  const drafts = loadDraftStore();
  const release = drafts.holdComposerDraft('task-c');
  release();
  await settle();
  drafts.restoreComposerDraft('task-c', draft({ text: 'first', library: [libraryFile('l')] }));
  drafts.restoreComposerDraft('task-c', draft({ text: 'second' }));
  const shown = drafts.readComposerDraft('task-c');
  assert.equal(shown.text, 'second\n\nfirst');
  assert.equal(shown.library.length, 1);
  drafts.discardDraft('task-c');
});

test('a draft handed between two composers on one task keeps its picks', async () => {
  const drafts = loadDraftStore();
  drafts.restoreComposerDraft('task-e', draft({ text: 't', library: [libraryFile('l')] }));
  const releaseLoading = drafts.holdComposerDraft('task-e');
  releaseLoading();
  const releaseView = drafts.holdComposerDraft('task-e');
  await settle();
  assert.equal(drafts.readComposerDraft('task-e').library.length, 1);
  releaseView();
  await settle();
  assert.deepEqual(drafts.readComposerDraft('task-e'), draft({ text: 't' }));
  drafts.discardDraft('task-e');
});

test("a workspace switch clears Home's drafts and banners and leaves task drafts alone", () => {
  const drafts = loadDraftStore();
  const workspace = loadTsx('src/features/chat/lib/workspace-client-state.ts', (name) => {
    if (name === './composer-banner-store') return banners;
    if (name === './draft-store') return drafts;
    throw new Error(name);
  });
  const generation = workspace.workspaceClientGeneration();
  banners.registerComposerBanner({ id: 'limit', kind: 'billing', message: 'Workspace A limit' });
  drafts.restoreComposerDraft(drafts.HOME_DRAFT_KEY, draft({ text: 'Workspace A private draft' }));
  drafts.setComposerText(drafts.OPENING_DRAFT_KEY, 'Workspace A too');
  drafts.setComposerText('task-g', 'task text');
  workspace.resetWorkspaceClientState();
  assert.deepEqual(banners.getComposerBanners(), []);
  assert.equal(drafts.readComposerDraft(drafts.HOME_DRAFT_KEY).text, '');
  assert.equal(drafts.readComposerDraft(drafts.OPENING_DRAFT_KEY).text, '');
  assert.equal(drafts.readComposerDraft('task-g').text, 'task text');
  assert.notEqual(workspace.workspaceClientGeneration(), generation);
  drafts.discardDraft('task-g');
});
