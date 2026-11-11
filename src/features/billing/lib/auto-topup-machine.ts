import { defineStateMachine } from '@/lib/state-machine';

// creating: claimed, no card chosen. charging: card frozen, so a retried create sends identical
// parameters; the payment may already exist. pending: Stripe returned the payment intent.
export const autoTopupMachine = defineStateMachine<
  'creating' | 'charging' | 'pending' | 'succeeded' | 'failed' | 'superseded'
>('automatic top-up', {
  creating: ['charging', 'failed', 'superseded'],
  charging: ['pending', 'succeeded', 'failed', 'superseded'],
  pending: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
  superseded: [],
});
