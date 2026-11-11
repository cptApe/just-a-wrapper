import { defineStateMachine } from '@/lib/state-machine';

export const creditGrantMachine = defineStateMachine<'issued' | 'retired'>('credit grant', {
  issued: ['issued', 'retired'],
  retired: [],
});
