// The billing status columns may move only along these tables; one table test per machine.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoTopupMachine } from '../../src/features/billing/lib/auto-topup-machine.ts';
import { budgetSyncMachine } from '../../src/features/billing/lib/budget-sync-machine.ts';
import { creditGrantMachine } from '../../src/features/billing/lib/credit-grant-machine.ts';
import { manualTopupMachine } from '../../src/features/billing/lib/manual-topup-machine.ts';
import { usageSettlementMachine } from '../../src/features/billing/lib/usage-settlement-machine.ts';

for (const [name, machine, allowed] of [
  [
    'budget sync',
    budgetSyncMachine,
    { idle: ['pending'], pending: ['pending', 'syncing'], syncing: ['syncing', 'pending', 'idle'] },
  ],
  ['usage settlement', usageSettlementMachine, { pending: ['complete'], complete: [] }],
  [
    'automatic top-up',
    autoTopupMachine,
    {
      creating: ['charging', 'failed', 'superseded'],
      charging: ['pending', 'succeeded', 'failed', 'superseded'],
      pending: ['succeeded', 'failed'],
      succeeded: [],
      failed: [],
      superseded: [],
    },
  ],
  [
    'manual top-up',
    manualTopupMachine,
    {
      open: ['processing', 'succeeded', 'failed', 'expired'],
      processing: ['succeeded', 'failed', 'expired'],
      failed: ['processing', 'succeeded', 'expired'],
      succeeded: [],
      expired: [],
    },
  ],
  ['credit grant', creditGrantMachine, { issued: ['issued', 'retired'], retired: [] }],
]) {
  test(`a ${name} row makes only the allowed moves, and a finished one never reopens`, () => {
    assert.deepEqual([...machine.states].sort(), Object.keys(allowed).sort());
    for (const from of machine.states)
      for (const to of machine.states) {
        const expected = allowed[from].includes(to);
        assert.equal(machine.can(from, to), expected, `${from} -> ${to}`);
        assert.equal(machine.sourcesOf(to).includes(from), expected, `${from} -> ${to}`);
      }
  });
}
