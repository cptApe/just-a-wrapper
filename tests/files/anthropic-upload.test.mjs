import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uploadFileToAnthropic } from '../../src/features/files/lib/anthropic-upload.ts';

const bytes = new Uint8Array([1, 2, 3, 4]);
const input = { bytes, filename: 'file.pdf', mimeType: 'application/pdf', sourceSizeBytes: 4 };
const clientWith = (upload) => ({ beta: { files: { upload } } });

test('the agent receives every byte of an attachment under its own name', async () => {
  const client = clientWith(async ({ file }) => {
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
    assert.equal(file.name, 'file.pdf');
    return { id: 'remote', size_bytes: file.size };
  });
  assert.deepEqual(await uploadFileToAnthropic(client, input), { fileId: 'remote', sizeBytes: 4 });
});

test('an empty, oversized, truncated or partly stored attachment is refused', async () => {
  const never = clientWith(async () => assert.fail('must not upload'));
  for (const patch of [
    { sourceSizeBytes: 0 },
    { bytes: new Uint8Array(2) },
    { sourceSizeBytes: 30 * 1024 * 1024 },
  ])
    await assert.rejects(uploadFileToAnthropic(never, { ...input, ...patch }), {
      code: 'VALIDATION_FAILED',
    });
  const partial = clientWith(async () => ({ id: 'remote', size_bytes: 2 }));
  await assert.rejects(uploadFileToAnthropic(partial, input), { code: 'VALIDATION_FAILED' });
});
