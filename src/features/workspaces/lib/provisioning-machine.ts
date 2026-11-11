import { defineStateMachine } from '@/lib/state-machine';

export const provisioningMachine = defineStateMachine('workspace provisioning', {
  pending: ['ready'],
  ready: ['pending'],
});
