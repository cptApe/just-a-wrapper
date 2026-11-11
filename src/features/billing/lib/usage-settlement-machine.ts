import { defineStateMachine } from '@/lib/state-machine';

export const usageSettlementMachine = defineStateMachine<'pending' | 'complete'>(
  'usage settlement',
  {
    pending: ['complete'],
    complete: [],
  },
);
