// Upload access and limits on the browser side and in the token route's checks.
// Server-side ownership on real rows lives in tests/integration/files-access.test.ts and files-sharing.test.ts.
import '../support/blob-test-env.mjs';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import * as React from 'react';
import { ROOT } from '../../src/features/files/lib/paths.ts';
import { uploadBody } from '../../src/features/files/lib/upload-body.ts';
import {
  requireOwnedUpload,
  requireUploadPath,
  uploadOwnerTag,
} from '../../src/features/files/lib/upload-policy.ts';
import { parseJsonBody } from '../../src/lib/route-kit.ts';
import { loadTsx } from '../support/load-tsx.mjs';

let upload;
globalThis.__blobClientTest = (...args) => upload(...args);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@vercel/blob/client')
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const upload = (...args) => globalThis.__blobClientTest(...args)',
      };
    return next(specifier, context);
  },
});
const client = await import('../../src/features/files/lib/client-upload.ts');
const { collectDroppedFiles } = loadTsx('src/features/files/hooks/use-direct-upload.ts', (name) => {
  if (name === 'react') return React;
  if (name === '../lib/paths') return { ROOT };
  return {};
});

test('an upload path cannot leave its workspace, its shared folder or reach thumbnails', () => {
  assert.deepEqual(requireUploadPath('ws-a', 'ws/ws-a/Reports/file.pdf', '/Reports'), {
    folderPath: '/Reports',
    filename: 'file.pdf',
  });
  for (const [path, scope] of [
    ['ws/ws-b/Reports/file.pdf', '/Reports'],
    ['ws/ws-a/Reports2/file.pdf', '/Reports'],
    ['ws/ws-a/Reports/../file.pdf', '/Reports'],
    ['ws/ws-a/.thumbs/file.webp', '/Reports'],
    ['ws/ws-a/.thumbs/file.webp', '/'],
  ]) {
    assert.throws(() => requireUploadPath('ws-a', path, scope), { code: 'FORBIDDEN' }, path);
  }
});

test('one member cannot finish an upload another member or a share started', () => {
  const pathname = `ws/workspace/Reports/${uploadOwnerTag('user-a')}-unique.pdf`;
  assert.equal(requireOwnedUpload('workspace', 'user-a', pathname, '/').folderPath, '/Reports');
  assert.equal(uploadOwnerTag('share:id'), 's-id');
  for (const [workspace, principal] of [
    ['workspace', 'user-b'],
    ['other', 'user-a'],
    ['workspace', 'share:id'],
  ]) {
    assert.throws(() => requireOwnedUpload(workspace, principal, pathname, '/'), {
      code: 'FORBIDDEN',
    });
  }
});

test('the token request the Blob SDK sends is accepted, so uploads can start', async () => {
  const body = {
    type: 'blob.generate-client-token',
    payload: { pathname: 'ws/test/u-user-file.txt', clientPayload: null, multipart: false },
  };
  const request = new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) });
  assert.deepEqual(await parseJsonBody(request, uploadBody), body);
  assert.equal(uploadBody.safeParse({ type: 'blob.upload-completed', payload: {} }).success, false);
});

test('a file over the plan limit is refused before any bytes leave the browser', async () => {
  upload = async () => assert.fail('oversized files never reach Blob');
  await assert.rejects(
    client.uploadBrowserFile({
      file: new File(['0123456789'], 'big.mov'),
      workspaceId: 'workspace',
      folderPath: '/',
      uploadTag: 'u-user',
      maxFileBytes: 5,
      shareToken: null,
      onProgress: null,
      signal: undefined,
    }),
    (error) => error.code === 'PLAN_LIMIT_REACHED' && /big\.mov is over/.test(error.message),
  );
});

test('a browser upload carries its owner tag and share token to the token route', async () => {
  const file = new File(['text'], 'report.txt');
  upload = async (path, body, options) => {
    assert.match(path, /^ws\/workspace\/Reports\/u-user-[a-f0-9-]+-report.txt$/);
    assert.equal(body, file);
    assert.equal(options.handleUploadUrl, '/api/files/upload-token?share=share-token');
    return { pathname: path };
  };
  const metadata = await client.uploadBrowserFile({
    file,
    workspaceId: 'workspace',
    folderPath: '/Reports',
    uploadTag: 'u-user',
    shareToken: 'share-token',
    onProgress: null,
  });
  assert.equal(metadata.originalFileName, 'report.txt');
});

test('a dropped folder uploads every file in every directory batch', async () => {
  const file = new File(['x'], 'notes.txt');
  const entry = { isFile: true, isDirectory: false, file: (resolve) => resolve(file) };
  const directory = (name, batches) => ({
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({ readEntries: (resolve) => resolve(batches.shift() ?? []) }),
  });
  const root = directory('Reports', [[entry], [directory('Drafts', [[entry], []])], []]);
  const files = await collectDroppedFiles({
    items: [{ kind: 'file', webkitGetAsEntry: () => root, getAsFile: () => null }],
  });
  assert.deepEqual(
    files.map(({ relativeDir }) => relativeDir),
    ['Reports', 'Reports/Drafts'],
  );
  assert.equal(files[0].file, file);
});
