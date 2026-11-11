// File lifecycles: trash moves only forward to a purge after thirty days, and a late upload sync cannot claim bytes the sweep may delete.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertFreshUpload } from '../../src/features/files/lib/stored-blob-machine.ts';
import { trashMachine, trashState } from '../../src/features/files/lib/trash-machine.ts';

test('a file moves only along the trash lifecycle, and an expired file can only be purged', () => {
  const allowed = [
    'live:trashed',
    'live:discarded',
    'trashed:live',
    'trashed:expired',
    'expired:purged',
  ];
  for (const from of trashMachine.states)
    for (const to of trashMachine.states)
      assert.equal(
        trashMachine.can(from, to),
        allowed.includes(`${from}:${to}`),
        `${from} -> ${to}`,
      );
});

test('trash expires at exactly thirty days', () => {
  const now = new Date('2026-11-08T00:00:00Z');
  assert.equal(trashState(null, now), 'live');
  assert.equal(trashState(new Date('2026-10-09T00:00:00Z'), now), 'expired');
  assert.equal(trashState(new Date('2026-10-09T00:00:00.001Z'), now), 'trashed');
});

test('an upload whose metadata sync arrives an hour late is refused before the sweep can remove its bytes', () => {
  const now = new Date();
  assert.doesNotThrow(() => assertFreshUpload(now, now));
  assert.throws(() => assertFreshUpload(new Date(now.getTime() - 3600000), now), {
    code: 'VALIDATION_FAILED',
  });
});
