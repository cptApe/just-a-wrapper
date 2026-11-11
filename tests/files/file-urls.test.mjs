import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadUrl } from '../../src/features/files/lib/download-url.ts';
import { thumbnailUrl } from '../../src/features/files/lib/thumbnail-url.ts';
import { fileContentUrl, parseFileContentUrl } from '../../src/lib/file-content-url.ts';

const id = '00000000-0000-4000-8000-000000000001';

test('a share viewer keeps the share token on thumbnails and downloads', () => {
  const url = fileContentUrl(id, 'secret');
  assert.equal(url, `/api/files/${id}/content?share=secret`);
  assert.equal(thumbnailUrl(url), `/api/files/${id}/thumbnail?share=secret`);
  assert.equal(downloadUrl(url), `/api/files/${id}/content?share=secret&download=1`);
  assert.equal(fileContentUrl('id', null), '/api/files/id/content');
  assert.equal(thumbnailUrl('https://example.com/image.png'), 'https://example.com/image.png');
});

test('content URL parsing refuses foreign and malformed URLs but keeps the share', () => {
  assert.deepEqual(parseFileContentUrl(fileContentUrl(id, 'a+b')), {
    fileId: id,
    shareToken: 'a+b',
  });
  for (const url of [
    `https://evil.test/api/files/${id}/content`,
    '/api/files/not-an-id/content',
    `/api/files/${id}/content/extra`,
  ])
    assert.equal(parseFileContentUrl(url), null, url);
});
