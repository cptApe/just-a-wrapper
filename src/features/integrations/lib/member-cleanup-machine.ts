import { defineStateMachine } from '@/lib/state-machine';

export const memberCleanupMachine = defineStateMachine('member cleanup', {
  pending: ['working'],
  working: ['working', 'pending'],
});
