import { defineStateMachine } from '@/lib/state-machine';

export const budgetSyncMachine = defineStateMachine('workspace budget sync', {
  idle: ['pending'],
  pending: ['pending', 'syncing'],
  syncing: ['syncing', 'pending', 'idle'],
});
