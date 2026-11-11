// With no Blob token, every storage call refuses with the uploads-off sentence,
// never as an upstream failure.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  BETTER_AUTH_SECRET: 'test-secret-with-at-least-thirty-two-characters',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
});
delete process.env.BLOB_READ_WRITE_TOKEN;

let providerCalls = 0;
globalThis.__blobOffTest = () => {
  providerCalls += 1;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@vercel/blob')
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(['get', 'head', 'put', 'del', 'list', 'issueSignedToken', 'presignUrl'].map((name) => `export const ${name} = (...args) => globalThis.__blobOffTest(...args);`).join('\n'))}`,
      };
    return next(specifier, context);
  },
});

const api = await import('../../src/features/files/api/blob-storage.ts');
const { CAPABILITY_OFF_MESSAGES } = await import('../../src/lib/capability-messages.ts');
const off = { code: 'INTEGRATION_NOT_CONNECTED', message: CAPABILITY_OFF_MESSAGES.uploads };

test('without a Blob token every storage call says uploads are off and never calls the provider', async () => {
  assert.equal(api.storageEnabled(), false);
  const bytes = new Uint8Array([1]);
  await assert.rejects(api.writeBlob('ws/a/file', bytes, 'text/plain'), off);
  await assert.rejects(api.readBlobBytes('ws/a/file', 10), off);
  await assert.rejects(api.inspectBlob('ws/a/file'), off);
  await assert.rejects(api.signedBlobUrl('ws/a/file'), off);
  await assert.rejects(api.deleteBlob('ws/a/file'), off);
  await assert.rejects(api.downloadBlob('ws/a/file', 'file'), off);
  await assert.rejects(api.listStoredBlobs('ws/', undefined), off);
  assert.equal(providerCalls, 0);
});
