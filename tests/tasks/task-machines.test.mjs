// Task, provider-sync and trigger-delivery lifecycles: every allowed and refused move. A removed task and a finished delivery never move again.
import assert from 'node:assert/strict';
import test from 'node:test';
import { taskMachine, taskProviderSyncMachine } from '../../src/features/tasks/lib/task-machine.ts';
import { triggerDeliveryMachine } from '../../src/features/tasks/lib/trigger-delivery-machine.ts';

for (const [name, machine, edges] of [
  [
    'provider sync',
    taskProviderSyncMachine,
    {
      synced: ['status', 'definition'],
      status: ['status', 'definition', 'synced'],
      definition: ['definition', 'synced'],
    },
  ],
  [
    'task',
    taskMachine,
    {
      creating: ['upcoming', 'removed'],
      upcoming: ['paused', 'running', 'done', 'removed'],
      paused: ['upcoming', 'done', 'removed'],
      running: ['done', 'removed'],
      done: ['removed'],
      removed: [],
    },
  ],
  [
    'delivery',
    triggerDeliveryMachine,
    {
      creating: ['session_created', 'ambiguous', 'failed'],
      ambiguous: ['session_created', 'failed'],
      session_created: ['completed'],
      completed: [],
      failed: [],
      skipped: [],
    },
  ],
]) {
  test(`a ${name} moves only along its lifecycle`, () => {
    for (const from of Object.keys(edges))
      for (const to of Object.keys(edges)) {
        const allowed = edges[from].includes(to);
        assert.equal(machine.can(from, to), allowed, from + ' -> ' + to);
        assert.equal(machine.sourcesOf(to).includes(from), allowed);
        if (allowed) machine.assertCan(from, to);
        else assert.throws(() => machine.assertCan(from, to), { code: 'CONFLICT' });
      }
  });
}
