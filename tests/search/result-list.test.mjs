import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  filterSearchResults,
  matchingCommands,
  recentSearchTasks,
} from '@/features/search/lib/result-list';

const groups = ['task', 'library', 'memory', 'app', 'skill', 'scheduled'];
const results = groups.map((group) => ({ group, id: group, title: group, href: '/app' }));

test('a type filter shows only its own results and no settings or quick actions', () => {
  assert.deepEqual(filterSearchResults(results, 'all'), results);
  for (const [value, expected] of [
    ['task', ['task']],
    ['library', ['library', 'memory']],
    ['app', ['app', 'skill']],
    ['scheduled', ['scheduled']],
  ]) {
    assert.deepEqual(
      filterSearchResults(results, value).map((row) => row.group),
      expected,
    );
    assert.deepEqual(matchingCommands('invite', value, { billingEnabled: true }), []);
  }
});

test('billing commands are hidden when billing is off', () => {
  const off = { billingEnabled: false };
  assert.deepEqual(matchingCommands('billing', 'all', off), []);
  assert.deepEqual(matchingCommands('usage', 'all', off), []);
  assert.equal(matchingCommands('billing', 'all', { billingEnabled: true }).length, 1);
});

test('Recent lists six distinct chats by last activity without reordering the sidebar', () => {
  const tasks = Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    title: i === 7 ? null : `Chat ${i}`,
    createdAt: new Date(2026, 8, i + 1),
    lastEventAt: null,
  }));
  tasks[0].lastEventAt = new Date(2026, 9, 1);
  const input = [...tasks, tasks[7]];
  const rows = recentSearchTasks(input);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['0', '7', '6', '5', '4', '3'],
  );
  assert.equal(rows[1].href, '/app/task/7');
  assert.equal(input[0].id, '0');
  assert.equal(input[7].id, '7');
});
