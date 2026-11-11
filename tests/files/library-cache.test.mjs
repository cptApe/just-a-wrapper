// Instant Library writes edit the cached list before the server answers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dropFiles,
  editLibraryCache,
  moveFolderTrees,
  removeFolderTrees,
  renameFolderTree,
} from '../../src/features/files/lib/library-cache.ts';
import { filesQueryKey } from '../../src/features/files/lib/library-items.ts';

const folder = (path) => ({ id: path, path, name: path.split('/').at(-1), createdAt: '' });
const paths = (rows) => rows.map((row) => row.path);

test('a folder edit changes its own subtree and never a sibling with the same prefix', () => {
  const folders = [folder('/a'), folder('/a/b'), folder('/ab')];
  assert.deepEqual(paths(removeFolderTrees(['/a'])(folders)), ['/ab']);
  assert.deepEqual(paths(renameFolderTree('/a', 'z')(folders)), ['/z', '/z/b', '/ab']);
  assert.deepEqual(paths(moveFolderTrees(['/a'], '/ab')(folders)), ['/ab/a', '/ab/a/b', '/ab']);
});

test('deleting a file removes only that row from every loaded page', () => {
  const cache = {
    pageParams: [0, 1],
    pages: [
      { files: [{ id: 'a' }, { id: 'b' }], hasMore: true },
      { files: [{ id: 'a' }, { id: 'c' }], hasMore: false },
    ],
  };
  const next = editLibraryCache(cache, { files: dropFiles(['a']) });
  assert.deepEqual(
    next.pages.map((page) => page.files.map((row) => row.id)),
    [['b'], ['c']],
  );
  assert.equal(editLibraryCache(undefined, { files: dropFiles(['a']) }), undefined);
});

test('the trash view and each search never share a cached list with the main view', () => {
  const base = { path: '/', type: null, q: '', trash: false, sort: 'modified', dir: 'desc' };
  assert.equal(filesQueryKey(base), filesQueryKey({ ...base }));
  assert.notEqual(filesQueryKey(base), filesQueryKey({ ...base, trash: true }));
  assert.notEqual(filesQueryKey(base), filesQueryKey({ ...base, q: 'x' }));
  assert.equal(filesQueryKey({ ...base, q: ' Xy ' }), filesQueryKey({ ...base, q: 'xy' }));
});
