import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isValidSegment,
  isWithin,
  normalizeFolderPath,
  ROOT,
  rewritePrefix,
  splitStoragePath,
} from '../../src/features/files/lib/paths.ts';

test('folder paths refuse traversal and separators but accept real-world names', () => {
  for (const [input, expected] of [
    ['', ROOT],
    ['/Reports//2026/', '/Reports/2026'],
    ['  /My Folder/2026-Q1  ', '/My Folder/2026-Q1'],
    ['/a/../b', null],
    ['/a/./b', null],
    ['/a/b<c', null],
  ])
    assert.equal(normalizeFolderPath(input), expected, input);
  for (const [segment, valid] of [
    ['Q1 report-final (v2).pdf', true],
    ['', false],
    ['..', false],
    ['a/b', false],
    ['a:b', false],
    ['a\\b', false],
  ])
    assert.equal(isValidSegment(segment), valid, segment);
});

test('a folder rename or move touches its subtree and never a sibling with the same prefix', () => {
  assert.equal(isWithin(ROOT, '/anything/deep'), true);
  assert.equal(isWithin('/A', '/A/B'), true);
  assert.equal(isWithin('/A', '/AB'), false);
  assert.equal(rewritePrefix('/A/B', '/A', '/Z'), '/Z/B');
  assert.equal(rewritePrefix('/AB', '/A', '/Z'), '/AB');
});

test('a storage path from another workspace is refused', () => {
  assert.deepEqual(splitStoragePath('ws1', 'ws/ws1/Reports/Q1 report-final (v2).pdf'), {
    folderPath: '/Reports',
    filename: 'Q1 report-final (v2).pdf',
  });
  assert.deepEqual(splitStoragePath('ws1', 'ws/ws1/a.pdf'), {
    folderPath: ROOT,
    filename: 'a.pdf',
  });
  assert.equal(splitStoragePath('ws1', 'ws/ws2/a.pdf'), null);
  assert.equal(splitStoragePath('ws1', '/elsewhere/a.pdf'), null);
});
