import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileKind, isImageMime, isVideoMime } from '../../src/features/files/lib/file-types.ts';

test('a file opens in the viewer for its type: a specific MIME wins, a generic one defers to the extension', () => {
  for (const [mime, name, kind] of [
    ['application/pdf', 'misleading.png', 'pdf'],
    ['image/png', 'misleading.pdf', 'image'],
    ['', 'deck.pptx', 'presentation'],
    ['', 'page.html', 'html'],
    ['text/plain', 'settings.json', 'code'],
    ['application/octet-stream', 'table.csv', 'spreadsheet'],
    ['Text/CSV; charset=utf-8', 'export', 'spreadsheet'],
  ])
    assert.equal(fileKind(mime, name), kind, `${mime} ${name}`);
  assert.equal(isImageMime('IMAGE/PNG'), true);
  assert.equal(isVideoMime('video/webm; codecs=vp9'), true);
  assert.equal(isVideoMime('audio/mpeg'), false);
});
