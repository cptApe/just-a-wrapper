import { defineStateMachine } from '@/lib/state-machine';
export const teamShareMachine = defineStateMachine('team visibility', {
  private: ['workspace'],
  workspace: ['private'],
});
