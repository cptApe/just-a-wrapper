import { defineStateMachine } from '@/lib/state-machine';

export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'canceled';
export const invitationMachine = defineStateMachine<InvitationStatus>('invitation', {
  pending: ['accepted', 'rejected', 'canceled'],
  accepted: [],
  rejected: [],
  canceled: [],
});
