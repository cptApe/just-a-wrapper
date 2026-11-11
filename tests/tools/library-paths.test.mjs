/** A path the agent writes cannot climb out of the folder it names. The workspace scoping of
 * Library reads and writes runs on Postgres in tests/integration/file-tools.test.ts. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mp3Filename, transcriptFilename } from '../../src/features/tool-catalog/voice.ts';
import { resolveLibraryItemPath } from '../../src/features/tools/lib/library-file.ts';
import { resolveLibraryPath } from '../../src/features/tools/lib/library-listing.ts';

test('a Library path that climbs with .. is refused for listing, reading and saving', () => {
  for (const bad of ['..', '/a/../etc', '/../secrets', 'a/../../b', '/x/./y/..']) {
    assert.ok(resolveLibraryPath(bad).message, bad);
    assert.ok(resolveLibraryItemPath(bad).message, bad);
  }
  assert.ok(resolveLibraryItemPath('/').message, 'the root is not a file');
  assert.deepEqual(resolveLibraryPath('/Reports/2026'), { path: '/Reports/2026' });
  assert.deepEqual(resolveLibraryItemPath('/Notes/plan.md'), { path: '/Notes/plan.md' });
});

test('a generated file name cannot place the file outside its folder', () => {
  assert.throws(() => mp3Filename('hello', '../escape.mp3'), { code: 'TOOL_INPUT_INVALID' });
  assert.equal(transcriptFilename('../Quarterly call.mp3'), 'Quarterly call.txt');
});
