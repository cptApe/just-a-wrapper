import assert from 'node:assert/strict';

export function requiredRow<T>(row: T | undefined): T {
  assert.ok(row !== undefined, 'Expected a fixture row');
  return row;
}
