import '../support/blob-test-env.mjs';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import sharp from 'sharp';

let sdk;
globalThis.__blobStorageTest = (...args) => sdk[args.shift()](...args);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@vercel/blob')
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(['get', 'head', 'put', 'del', 'list', 'issueSignedToken', 'presignUrl'].map((name) => `export const ${name} = (...args) => globalThis.__blobStorageTest('${name}', ...args);`).join('\n'))}`,
      };
    return next(specifier, context);
  },
});
const api = await import('../../src/features/files/api/blob-storage.ts');
const response = (bytes) => ({ statusCode: 200, stream: new Response(bytes).body });

test('a private read over its byte limit fails, and a missing blob is not found', async () => {
  sdk = {
    get: async (_path, options) => {
      assert.equal(options.access, 'private');
      return response('abc');
    },
  };
  assert.equal(new TextDecoder().decode(await api.readBlobBytes('ws/a/file', 3)), 'abc');
  await assert.rejects(api.readBlobBytes('ws/a/file', 2), { code: 'VALIDATION_FAILED' });
  sdk = { get: async () => null };
  await assert.rejects(api.readBlobBytes('missing', 10), { code: 'ARTIFACT_NOT_FOUND' });
  await assert.rejects(api.downloadBlob('missing', 'name'), { code: 'ARTIFACT_NOT_FOUND' });
});

test('a signed read link expires within five minutes', async () => {
  let issues = 0;
  sdk = {
    issueSignedToken: async (options) => {
      issues++;
      assert.deepEqual(options.operations, ['get']);
      return {};
    },
    presignUrl: async (_token, options) => {
      assert.ok(options.validUntil <= Date.now() + 300_000);
      return { presignedUrl: 'https://example.com/signed' };
    },
  };
  await api.signedBlobUrl('one');
  await api.signedBlobUrl('two');
  assert.equal(issues, 1);
});

test('a download is served under the renamed display filename', async () => {
  sdk = { get: async () => response('hello') };
  const download = await api.downloadBlob('immutable-key', 'Renamed report.txt');
  assert.equal(await download.text(), 'hello');
  assert.equal(
    download.headers.get('content-disposition'),
    "attachment; filename*=UTF-8''Renamed%20report.txt",
  );
});

test('thumbnails are private WebP previews and skip oversized or unsupported images', async () => {
  const bytes = await sharp({
    create: { width: 2048, height: 1024, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  let stored;
  sdk = {
    put: async (pathname, image, options) => {
      stored = { image, options };
      return { pathname };
    },
  };
  assert.equal(
    await api.createThumbnail({ workspaceId: 'a', fileId: 'id', bytes, mimeType: 'image/png' }),
    'ws/a/.thumbs/id.webp',
  );
  assert.equal((await sharp(stored.image).metadata()).format, 'webp');
  assert.equal(stored.options.access, 'private');
  sdk = { put: () => assert.fail('must not write a thumbnail') };
  for (const input of [
    { bytes: new Uint8Array(api.THUMBNAIL_SOURCE_MAX_BYTES + 1), mimeType: 'image/png' },
    { bytes: new Uint8Array(), mimeType: 'image/heic' },
    { bytes: new Uint8Array([1]), mimeType: 'image/png' },
  ])
    assert.equal(await api.createThumbnail({ workspaceId: 'a', fileId: 'id', ...input }), null);
});

test('an explicit delete that fails at the provider reports the failure', async () => {
  sdk = {
    del: async () => {
      throw new Error('delete unavailable');
    },
  };
  await assert.rejects(api.deleteBlob('orphan'), { code: 'EXTERNAL_API_FAILED' });
});
