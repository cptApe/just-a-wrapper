import { defineStateMachine } from '@/lib/state-machine';

export const vaultMachine = defineStateMachine('member vault', {
  unprovisioned: ['provisioning'],
  provisioning: ['provisioning', 'unprovisioned', 'provisioned'],
  provisioned: ['provisioning'],
});
