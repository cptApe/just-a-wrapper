import { defineStateMachine } from '@/lib/state-machine';
import type { TriggerDelivery } from '../types';

export const triggerDeliveryMachine = defineStateMachine<TriggerDelivery['state']>(
  'trigger delivery',
  {
    creating: ['session_created', 'ambiguous', 'failed'],
    ambiguous: ['session_created', 'failed'],
    session_created: ['completed'],
    completed: [],
    failed: [],
    skipped: [],
  },
);
