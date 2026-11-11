import { defineStateMachine } from '@/lib/state-machine';

export const accountLifecycleMachine = defineStateMachine<'live' | 'deleted' | 'anonymized'>(
  'account',
  {
    live: ['deleted'],
    deleted: ['anonymized'],
    anonymized: [],
  },
);
