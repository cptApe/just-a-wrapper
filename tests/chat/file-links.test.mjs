/** A file link in a reply opens the file it names, never a different one, and a locked file has no download. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  downloadAction,
  primaryAction,
  resolveFileLink,
} from '../../src/features/chat/lib/file-link.ts';

const artifact = (id, filename, mimeType, extra = {}) => ({
  id,
  anthropicFileId: `file_${id}`,
  filename,
  mimeType,
  sizeBytes: 10,
  downloadable: true,
  savedDriveFileId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});
const libraryFile = (id, filename, url) => ({
  id,
  filename,
  folderPath: '/',
  mimeType: 'application/pdf',
  sizeBytes: 10,
  url,
  source: 'user_upload',
  createdAt: '2026-01-01T00:00:00.000Z',
});
const UPLOAD_ID = '00000000-0000-4000-8000-000000000001';
const upload = libraryFile(UPLOAD_ID, 'invoice.pdf', `/api/files/${UPLOAD_ID}/content`);
const locked = artifact('a-locked', 'secret.csv', 'text/csv', { downloadable: false });
const index = {
  libraryFiles: [upload],
  artifacts: [artifact('a-pdf', 'report.pdf', 'application/pdf'), locked],
  sessionId: 'sesn_1',
};

test('a link resolves only to the file it exactly names; an unknown or ambiguous one opens nothing', () => {
  assert.equal(
    resolveFileLink('/api/artifacts/a-pdf/content?download=1', index).artifact.id,
    'a-pdf',
  );
  assert.equal(resolveFileLink(`/api/files/${UPLOAD_ID}/content`, index).file.id, UPLOAD_ID);
  assert.equal(
    resolveFileLink('sandbox:/mnt/session/outputs/report.pdf', index).artifact.id,
    'a-pdf',
  );
  assert.equal(resolveFileLink('/mnt/user/invoice.pdf', index).file.id, UPLOAD_ID);
  for (const href of [
    '/api/artifacts/nope/content',
    '/api/files/missing/content',
    'https://example.com/invoice.pdf',
    '/mnt/user/missing.pdf',
    '#report.pdf',
  ])
    assert.equal(resolveFileLink(href, index), null, href);
  const twice = {
    ...index,
    artifacts: [artifact('a-old', 'report.pdf', ''), artifact('a-new', 'report.pdf', '')],
  };
  assert.equal(resolveFileLink('report.pdf', twice).artifact.id, 'a-new');
  const ambiguous = {
    ...index,
    artifacts: [],
    libraryFiles: [upload, libraryFile('lib-3', 'invoice.pdf', 'https://x/2')],
  };
  assert.equal(resolveFileLink('invoice.pdf', ambiguous), null);
});

test('a file marked not downloadable gets no download link', () => {
  assert.equal(downloadAction({ kind: 'artifact', artifact: locked, sessionId: 'sesn_1' }), null);
  assert.equal(
    primaryAction({ kind: 'artifact', artifact: locked, sessionId: 'sesn_1' }).kind,
    'open',
  );
  assert.equal(primaryAction({ kind: 'artifact', artifact: locked, sessionId: null }), null);
});
