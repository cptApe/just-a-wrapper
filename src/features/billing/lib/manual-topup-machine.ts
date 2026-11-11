import { defineStateMachine } from '@/lib/state-machine';

// A failed card can still settle when a retry finds the payment went through; succeeded and expired are final.
export const manualTopupMachine = defineStateMachine<
  'open' | 'processing' | 'succeeded' | 'failed' | 'expired'
>('manual top-up', {
  open: ['processing', 'succeeded', 'failed', 'expired'],
  processing: ['succeeded', 'failed', 'expired'],
  failed: ['processing', 'succeeded', 'expired'],
  succeeded: [],
  expired: [],
});
