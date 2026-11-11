import { defineStateMachine } from '@/lib/state-machine';
export const sessionSendMachine = defineStateMachine('session send', {
  sending: ['delivered', 'error', 'unconfirmed'],
  error: ['sending', 'delivered'],
  unconfirmed: ['delivered', 'error'],
  delivered: [],
});
