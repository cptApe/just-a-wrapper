import assert from 'node:assert/strict';

export function requiredEntry<T>(entries: readonly T[], index: number): T {
  const entry = entries.at(index);
  assert.ok(entry !== undefined, `Expected test entry at index ${index}`);
  return entry;
}
