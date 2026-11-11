import { defineStateMachine } from '@/lib/state-machine';

export const trashMachine = defineStateMachine('trash', {
  live: ['trashed', 'discarded'],
  trashed: ['live', 'expired'],
  expired: ['purged'],
  purged: [],
  discarded: [],
});

export function trashCutoff(now: Date): Date {
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}

export function trashState(deletedAt: Date | null, now: Date): 'live' | 'trashed' | 'expired' {
  if (deletedAt === null) return 'live';
  return deletedAt > trashCutoff(now) ? 'trashed' : 'expired';
}
