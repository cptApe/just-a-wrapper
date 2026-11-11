import type { session } from '@/db/schema/session';
import { defineStateMachine } from '@/lib/state-machine';

export const sessionMachine = defineStateMachine<typeof session.$inferSelect.status>('session', {
  creating: ['awaiting_opening', 'opening', 'creation_cleanup', 'terminated'],
  creation_cleanup: ['terminated'],
  awaiting_opening: ['opening', 'creation_cleanup', 'terminated'],
  opening: [
    'creation_cleanup',
    'awaiting_opening',
    'running',
    'idle',
    'requires_input',
    'rescheduling',
    'pausing',
    'terminated',
  ],
  idle: ['idle', 'running', 'rescheduling', 'requires_input', 'pausing', 'terminated'],
  running: ['running', 'idle', 'rescheduling', 'requires_input', 'pausing', 'terminated'],
  rescheduling: ['rescheduling', 'running', 'idle', 'requires_input', 'pausing', 'terminated'],
  requires_input: ['requires_input', 'running', 'idle', 'rescheduling', 'pausing', 'terminated'],
  pausing: ['pausing', 'paused_no_credits', 'terminated'],
  paused_no_credits: ['resuming', 'terminated'],
  resuming: ['paused_no_credits', 'running', 'pausing', 'terminated'],
  terminated: [],
});

type SessionStatus = Parameters<typeof sessionMachine.can>[0];

// The pause episode: these statuses, and only these, carry paused_at and paused_reason
// (session_pause_consistency_check).
export function isPauseStatus(status: SessionStatus): boolean {
  return status === 'pausing' || status === 'paused_no_credits' || status === 'resuming';
}

// A chat in these statuses holds one of the plan's chats-at-once slots: its turn is starting,
// working or being retried by the provider. A chat waiting on a person (requires_input), idle,
// deferred or paused spends nothing until its next turn start passes the limit again.
export const CHAT_SLOT_STATUSES = [
  'creating',
  'opening',
  'running',
  'rescheduling',
  'resuming',
] as const satisfies readonly SessionStatus[];

export function publicSessionStatus(status: SessionStatus) {
  switch (status) {
    case 'creating':
    case 'creation_cleanup':
    case 'awaiting_opening':
      return 'idle';
    case 'opening':
      return 'running';
    case 'pausing':
    case 'resuming':
      return 'paused_no_credits';
    default:
      return status;
  }
}
