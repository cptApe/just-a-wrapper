/** Files picked in the composer upload once, reach the agent with a readable path, and show as clean chips. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as cache from '../../src/features/chat/lib/attachment-mount-cache.ts';
import * as response from '../../src/features/chat/lib/attachment-response.ts';
import * as uploadMachine from '../../src/features/chat/lib/attachment-upload-machine.ts';
import { attachmentSendGate } from '../../src/features/chat/lib/attachment-validation.ts';
import {
  buildComposerMessage,
  LIBRARY_READ_INSTRUCTION,
} from '../../src/features/sessions/lib/build-composer-message.ts';
import { stripAttachedFiles } from '../../src/features/sessions/lib/strip-attached-files.ts';
import * as capabilityMessages from '../../src/lib/capability-messages.ts';
import { AppError } from '../../src/lib/errors.ts';
import { loadTsx } from '../support/load-tsx.mjs';

function pipeline(upload) {
  return loadTsx('src/features/chat/lib/attachments.ts', (name) => {
    if (name === '@/features/files/lib/client-upload') return { uploadBrowserFile: upload };
    if (name === '@/lib/errors') return { AppError };
    if (name === '@/lib/capability-messages') return capabilityMessages;
    if (name === '@/lib/expected-state-error') return { isExpectedUserStateError: () => true };
    if (name === '@/lib/observability-client') return { captureException: () => {} };
    if (name === './attachment-response') return response;
    if (name === './attachment-upload-machine') return uploadMachine;
    if (name === './attachment-mount-cache') return cache;
    throw new Error(`Unexpected dependency ${name}`);
  });
}
const context = { workspaceId: 'workspace', uploadConfig: { enabled: true } };
const mounted = {
  fileId: 'file-1',
  anthropicFileId: 'remote-1',
  name: 'picture.png',
  durableUrl: 'https://example.com/picture.png',
  mountedPath: '/mnt/picture.png',
};
const saved = {
  id: 'file-1',
  filename: 'picture.png',
  url: mounted.durableUrl,
  mimeType: 'image/png',
  sizeBytes: 5,
};
const file = () => new File(['bytes'], 'picture.png', { type: 'image/png' });
const start = (api) =>
  uploadMachine.reduceAttachmentUpload(api.createPendingAttachment(file()), { type: 'start' });
const stored = { storagePath: '/picture.png', url: mounted.durableUrl, sizeBytes: 5 };

test('a file picked on Home uploads once, then mounts into the new task without a second upload', async (t) => {
  let uploads = 0;
  const requests = [];
  const api = pipeline(async () => {
    uploads++;
    return stored;
  });
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    return Response.json(body.sessionId ? { attachment: mounted } : { file: saved });
  });
  const pending = start(api);
  const ready = await api.preparePendingAttachment(pending, context);
  assert.equal(ready.status, 'ready');
  const sent = await api.uploadAndAttach([ready], context, 'home-session');
  assert.deepEqual(sent.attached, [mounted]);
  assert.equal(requests[1].existingFileId, 'file-1');
  assert.equal(uploads, 1);
  api.releasePendingAttachment(pending);
});

test('a failed upload holds the send until a retry succeeds', async (t) => {
  let attempts = 0;
  const api = pipeline(async () => {
    if (++attempts === 1) throw new TypeError('Network disconnected');
    return stored;
  });
  t.mock.method(globalThis, 'fetch', async (_url, init) =>
    Response.json(JSON.parse(init.body).existingFileId ? { attachment: mounted } : { file: saved }),
  );
  const pending = start(api);
  const failed = await api.preparePendingAttachment(pending, context, 'retry-session');
  assert.equal(attachmentSendGate([failed]), 'failed');
  const ready = await api.preparePendingAttachment(
    uploadMachine.reduceAttachmentUpload(failed, { type: 'start' }),
    context,
    'retry-session',
  );
  assert.equal(attachmentSendGate([ready]), 'ready');
  assert.equal(attachmentSendGate([ready, { status: 'uploading' }]), 'uploading');
  assert.equal(attachmentSendGate([ready, failed]), 'failed');
  api.releasePendingAttachment(pending);
});

test('a failed mount retries the saved file without uploading it twice', async (t) => {
  let uploads = 0;
  let mounts = 0;
  const api = pipeline(async () => {
    uploads++;
    return { storagePath: '/picture.png' };
  });
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (!JSON.parse(init.body).existingFileId) return Response.json({ file: saved });
    if (++mounts === 1)
      return Response.json(
        { error: { code: 'API_REQUEST_FAILED', message: 'Mount unavailable' } },
        { status: 503 },
      );
    return Response.json({ attachment: mounted });
  });
  const pending = start(api);
  const failed = await api.preparePendingAttachment(pending, context, 'mount-retry');
  assert.equal(failed.status, 'failed');
  const ready = await api.preparePendingAttachment(
    uploadMachine.reduceAttachmentUpload(failed, { type: 'start' }),
    context,
    'mount-retry',
  );
  assert.equal(ready.status, 'ready');
  assert.deepEqual([uploads, mounts], [1, 2]);
  api.releasePendingAttachment(pending);
});

test('removing a file mid-upload stops it and never mounts it into the task', async (t) => {
  const controller = new AbortController();
  const api = pipeline(async ({ signal }) => {
    assert.equal(signal, controller.signal);
    controller.abort();
    return { storagePath: '/cancelled.png' };
  });
  let mounts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    mounts++;
    return Response.json({ attachment: mounted });
  });
  const pending = start(api);
  await assert.rejects(api.preparePendingAttachment(pending, context, 'cancel', controller.signal));
  assert.equal(mounts, 0);
  api.releasePendingAttachment(pending);
});

test('the same file in a later task is remounted from its saved row, not uploaded again', () => {
  const picked = new File(['hello'], 'report.txt', { type: 'text/plain' });
  cache.rememberCachedAttachment(picked, 'session_1', { ...mounted, name: 'report.txt' });
  assert.equal(cache.findCachedAttachment(picked, 'session_1').kind, 'mounted');
  cache.clearMountedAttachmentsForSession('session_1');
  assert.deepEqual(cache.findCachedAttachment(picked, 'session_2'), {
    kind: 'persisted',
    fileId: 'file-1',
  });
});

test('a mount response missing the sandbox path is refused, not sent to the agent', () => {
  assert.throws(
    () =>
      response.readMountedAttachment(
        { attachment: { fileId: 'local' } },
        'session',
        'a.pdf',
        'uploaded',
      ),
    (error) => error.code === 'API_REQUEST_FAILED' && error.cause !== undefined,
  );
});

test('the agent gets each file and folder with a path it can read', () => {
  const library = {
    id: 'file-1',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1200,
    url: 'https://cdn.example.com/report.pdf',
  };
  const folder = { name: 'Planning', path: '/planning', itemCount: 3 };
  const upload = {
    name: 'data.csv',
    durableUrl: 'https://cdn.example.com/data.csv',
    mountedPath: '/mnt/uploads/data.csv',
  };
  assert.equal(buildComposerMessage('Summarize this', [], [], []), 'Summarize this');
  const message = buildComposerMessage(
    'Summarize this',
    [library],
    [folder],
    [{ id: 's', name: 'Research' }],
    [upload],
  );
  for (const line of [
    'Use the "Research" skill for this task.',
    'report.pdf — https://cdn.example.com/report.pdf',
    'data.csv — https://cdn.example.com/data.csv',
    'Agent sandbox path for data.csv: /mnt/uploads/data.csv',
    'Planning/ (folder) — Library folder /planning',
    LIBRARY_READ_INSTRUCTION,
  ])
    assert.ok(message.split('\n').includes(line), line);
});

const PRIVATE_ROUTE = '/api/files/00000000-0000-4000-8000-000000000001/content';

test('a sent message shows the person clean chips, never the agent paths or instructions', () => {
  const raw = buildComposerMessage(
    'Look at this.',
    [
      {
        id: 'f',
        name: 'a — b.txt',
        mimeType: 'text/plain',
        sizeBytes: 1,
        url: 'https://x.example.com/a',
      },
    ],
    [{ name: 'Q3 Numbers', path: '/finance/q3', itemCount: 1 }],
    [],
    [{ name: 'report.pdf', durableUrl: PRIVATE_ROUTE, mountedPath: '/mnt/session/report.pdf' }],
  );
  const shown = stripAttachedFiles(raw);
  assert.equal(shown.text, 'Look at this.');
  assert.deepEqual(shown.entries, [
    { kind: 'file', name: 'a — b.txt', url: 'https://x.example.com/a' },
    { kind: 'file', name: 'report.pdf', url: PRIVATE_ROUTE },
    { kind: 'folder', name: 'Q3 Numbers', path: '/finance/q3' },
  ]);
  assert.deepEqual(
    stripAttachedFiles('<attached_files>\njust-a-name.txt\nnotes.md — pending\n</attached_files>')
      .entries,
    [
      { kind: 'file', name: 'just-a-name.txt', url: null },
      { kind: 'file', name: 'notes.md', url: null },
    ],
  );
  assert.deepEqual(stripAttachedFiles('just a normal message'), {
    text: 'just a normal message',
    entries: [],
    hadAttachments: false,
  });
});
