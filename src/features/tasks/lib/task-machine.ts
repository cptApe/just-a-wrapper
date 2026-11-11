import type { task } from '@/db/schema';
import { defineStateMachine } from '@/lib/state-machine';

// What the task is. The provider follows it through `taskProviderSyncMachine`.
export const taskMachine = defineStateMachine<typeof task.$inferSelect.status>('task', {
  creating: ['upcoming', 'removed'],
  upcoming: ['paused', 'running', 'done', 'removed'],
  paused: ['upcoming', 'done', 'removed'],
  running: ['done', 'removed'],
  done: ['removed'],
  removed: [],
});

// What the provider still has to hear. A definition push also carries the status, so a pending
// definition never drops back to a status-only push.
export const taskProviderSyncMachine = defineStateMachine<typeof task.$inferSelect.providerSync>(
  'task provider sync',
  {
    synced: ['status', 'definition'],
    status: ['status', 'definition', 'synced'],
    definition: ['definition', 'synced'],
  },
);
