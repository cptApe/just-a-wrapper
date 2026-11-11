import { defineStateMachine } from '@/lib/state-machine';

export const skillMachine = defineStateMachine('skill', {
  ready: ['publishing', 'deleting'],
  publishing: ['ready', 'deleting'],
  deleting: [],
});
