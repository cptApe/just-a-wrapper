// A new or renamed note never takes a path another note already has. The SDK transport records calls.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mock, test } from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/observability')
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export function captureException() {}',
      };
    return nextResolve(specifier, context);
  },
});
const { createBlankNoteAtAvailablePath, listSiblingNotePaths } = await import(
  '../../src/features/memory/api/create-blank-note.ts'
);
const { applyDerivedNoteTitle } = await import(
  '../../src/features/memory/api/apply-derived-note-title.ts'
);
const { AppError } = await import('../../src/lib/errors.ts');
const { isValidNotePath, normalizeNoteFolder } = await import(
  '../../src/features/memory/lib/notes.ts'
);
function remote(path, content = '') {
  return {
    type: 'memory',
    id: 'mem_123',
    path,
    content,
    content_sha256: 'f'.repeat(64),
    content_size_bytes: content.length,
    created_at: '2026-08-19T00:00:00Z',
    updated_at: '2026-08-19T00:00:00Z',
  };
}
function note(path, content = '') {
  const row = remote(path, content);
  return {
    id: row.id,
    path,
    content,
    contentSha256: row.content_sha256,
    sizeBytes: row.content_size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function client(overrides = {}) {
  return {
    beta: {
      memoryStores: {
        memories: {
          list: async () => ({ data: [], next_page: null }),
          create: async (_store, { path, content }) => remote(path, content),
          update: async (_id, { path }) => remote(path),
          ...overrides,
        },
      },
    },
  };
}
test('a new note takes the next free Untitled name in its folder', async () => {
  const calls = [];
  const sdk = client({
    list: async (_store, params) => {
      calls.push(params);
      return {
        data: [remote('/projects/Untitled.md'), remote('/projects/Untitled (2).md')],
        next_page: null,
      };
    },
    create: async (store, payload) => {
      calls.push({ store, ...payload });
      return remote(payload.path, payload.content);
    },
  });
  const created = await createBlankNoteAtAvailablePath(sdk, 'store', '/projects');
  assert.equal(created.path, '/projects/Untitled (3).md');
  assert.equal(calls[0].path_prefix, '/projects/');
  assert.equal(calls[1].content, '');
});
test('a note created at the same moment elsewhere causes one retry at the next suffix, not an overwrite', async () => {
  const attempts = [];
  const sdk = client({
    create: async (_store, { path }) => {
      attempts.push(path);
      if (attempts.length === 1) throw new AppError('MEMORY_PATH_CONFLICT', 'taken');
      return remote(path);
    },
  });
  await createBlankNoteAtAvailablePath(sdk, 'store', '/');
  assert.deepEqual(attempts, ['/Untitled.md', '/Untitled (2).md']);
});
test('a huge folder stops listing after ten pages and picks a name that cannot clash with an unseen note', async () => {
  mock.method(Date, 'now', () => 1234567890);
  try {
    let pages = 0;
    const sdk = client({ list: async () => ({ data: [], next_page: `page-${++pages}` }) });
    const created = await createBlankNoteAtAvailablePath(sdk, 'store', '/');
    assert.equal(pages, 10);
    assert.equal(created.path, '/Untitled (1234567890).md');
  } finally {
    mock.restoreAll();
  }
});
test('a provider cursor that loops fails instead of listing forever', async () => {
  for (const cursors of [
    ['a', 'a'],
    ['a', 'b', 'a'],
  ]) {
    let count = 0;
    const sdk = client({ list: async () => ({ data: [], next_page: cursors[count++] }) });
    await assert.rejects(
      () => listSiblingNotePaths(sdk, 'store', '/'),
      (error) => error instanceof AppError && error.code === 'EXTERNAL_API_FAILED',
    );
    assert.equal(count, cursors.length);
  }
});
test('a failed automatic rename keeps the saved note and its fresh SHA', async () => {
  const saved = note('/Untitled.md', '# New title');
  const sdk = client({
    update: async () => {
      throw new Error('upstream unavailable');
    },
  });
  assert.deepEqual(await applyDerivedNoteTitle(sdk, 'store', saved, saved.content), {
    note: saved,
    titleUpdated: false,
  });
});
test('automatic naming keeps the extension and never takes a sibling name', async () => {
  const saved = note('/Untitled (2).txt', '# Stable title');
  const sdk = client({
    list: async () => ({ data: [remote('/Stable title.txt')], next_page: null }),
  });
  const renamed = await applyDerivedNoteTitle(sdk, 'store', saved, saved.content);
  assert.equal(renamed.note.path, '/Stable title (2).txt');
  assert.equal(renamed.titleUpdated, true);
});
test('a note the person named is never renamed automatically', async () => {
  const saved = note('/Manual.md', '# Different title');
  const sdk = client({ list: assert.fail, update: assert.fail });
  assert.deepEqual(await applyDerivedNoteTitle(sdk, 'store', saved, saved.content), {
    note: saved,
    titleUpdated: true,
  });
});

test('a note path cannot climb out of its store or be malformed', () => {
  for (const [path, valid] of [
    ['/projects/just a wrapper/notes.md', true],
    ['about.md', false],
    ['/a//b.md', false],
    ['/a/', false],
    ['/../x.md', false],
  ])
    assert.equal(isValidNotePath(path), valid, path);
  assert.equal(normalizeNoteFolder(' /projects/ '), '/projects');
  assert.equal(normalizeNoteFolder('/a/../b'), null);
});
