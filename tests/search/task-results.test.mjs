import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchCachedTaskTitles, mergeSearchResults } from '@/features/search/lib/task-results';

function task(id, title, lastEventAt = new Date('2026-09-01T00:00:00Z')) {
  return { id, title, status: 'completed', lastEventAt, createdAt: lastEventAt };
}

test('instant task matches ignore case, rank prefix matches first and show each task once', () => {
  const rows = [
    task('a', 'Weekly report about acme', new Date('2026-09-03T00:00:00Z')),
    task('b', 'Acme pricing', new Date('2026-09-01T00:00:00Z')),
    task('c', 'acme onboarding', new Date('2026-09-02T00:00:00Z')),
    task('d', 'Unrelated'),
    task('e', null),
  ];
  const results = matchCachedTaskTitles([...rows, rows[1]], '  ACME ');
  assert.deepEqual(
    results.map((r) => r.id),
    ['c', 'b', 'a'],
  );
  assert.equal(results[0].href, '/app/task/c');
  assert.deepEqual(matchCachedTaskTitles(rows, '   '), []);
});

test('server results join the instant ones without duplicates and tasks cap at five', () => {
  const cached = [
    { group: 'task', id: 'a', title: 'Acme A', href: '/app/task/a' },
    { group: 'task', id: 'b', title: 'Acme B', href: '/app/task/b' },
  ];
  const server = [
    { group: 'task', id: 'b', title: 'Acme B', href: '/app/task/b' },
    { group: 'task', id: 'z', title: 'Older', href: '/app/task/z' },
    { group: 'library', id: 'f', title: 'acme.pdf', href: '/app/library' },
  ];
  assert.deepEqual(
    mergeSearchResults(cached, server).map((r) => `${r.group}:${r.id}`),
    ['task:a', 'task:b', 'task:z', 'library:f'],
  );
  const five = Array.from({ length: 5 }, (_, i) => ({
    group: 'task',
    id: `c${i}`,
    title: `Acme ${i}`,
    href: `/app/task/c${i}`,
  }));
  const merged = mergeSearchResults(five, [{ ...cached[0], id: 's' }]);
  assert.equal(merged.filter((r) => r.group === 'task').length, 5);
});
