import { defineStateMachine } from '@/lib/state-machine';

export const workspaceLifecycleMachine = defineStateMachine<
  'live' | 'deleting' | 'deleted' | 'purging'
>('workspace', {
  live: ['deleting'],
  deleting: ['deleted'],
  deleted: ['purging'],
  purging: ['purging'],
});
