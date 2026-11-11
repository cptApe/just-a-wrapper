import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_NOTE_PAGES, matchNotesByPath } from '../../src/features/search/lib/match-notes.ts';

function store(pages) {
  const reads = [];
  return {
    reads,
    listPage: async (cursor) => {
      reads.push(cursor);
      const index = cursor === null ? 0 : Number(cursor);
      return {
        notes: pages[index].map((path) => ({ path })),
        nextCursor: index + 1 < pages.length ? String(index + 1) : null,
      };
    },
  };
}

test('memory search finds a note on a later page, not only the first', async () => {
  const { listPage, reads } = store([['/a.md', '/b.md'], ['/c.md'], ['/projects/Acme plan.md']]);
  const found = await matchNotesByPath({ query: 'acme', limit: 50, listPage });
  assert.deepEqual(
    found.map((note) => note.path),
    ['/projects/Acme plan.md'],
  );
  assert.deepEqual(reads, [null, '1', '2']);
});

test('memory search stops reading at the result limit and at the page cap', async () => {
  const many = store([['/x1.md', '/x2.md'], ['/x3.md']]);
  const limited = await matchNotesByPath({ query: 'x', limit: 2, listPage: many.listPage });
  assert.equal(limited.length, 2);
  assert.deepEqual(many.reads, [null]);
  let reads = 0;
  await matchNotesByPath({
    query: 'none',
    limit: 5,
    listPage: async () => {
      reads += 1;
      return { notes: [{ path: '/a.md' }], nextCursor: 'more' };
    },
  });
  assert.equal(reads, MAX_NOTE_PAGES);
});
