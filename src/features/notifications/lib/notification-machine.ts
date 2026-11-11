import { defineStateMachine } from '@/lib/state-machine';

export const notificationEmailMachine = defineStateMachine<
  'pending' | 'sending' | 'sent' | 'skipped' | 'expired'
>('notification email', {
  // A retry that finds the person opted out or gone skips; one past the retry window expires.
  pending: ['sending', 'skipped', 'expired'],
  sending: ['pending', 'sent', 'skipped', 'expired'],
  sent: [],
  skipped: [],
  expired: [],
});
