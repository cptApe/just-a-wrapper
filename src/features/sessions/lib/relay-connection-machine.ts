import { defineStateMachine } from '@/lib/state-machine';
export const relayConnectionMachine = defineStateMachine<
  'connecting' | 'replaying' | 'tailing' | 'closed'
>('relay connection', {
  connecting: ['replaying', 'closed'],
  replaying: ['tailing', 'closed'],
  tailing: ['closed'],
  closed: [],
});
