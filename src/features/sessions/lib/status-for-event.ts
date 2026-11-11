import type { BetaManagedAgentsStreamSessionEvents } from '@anthropic-ai/sdk/resources/beta/sessions/events';

export type SyncableSessionStatus =
  | 'running'
  | 'rescheduling'
  | 'idle'
  | 'requires_input'
  | 'terminated';

/** Map status events to DB status; requires_action idles become requires_input.
 * The relay and stale-status sweep share this mapping. */
export function statusForEvent(
  event: BetaManagedAgentsStreamSessionEvents,
): SyncableSessionStatus | null {
  switch (event.type) {
    case 'session.status_running':
      return 'running';
    case 'session.status_rescheduled':
      return 'rescheduling';
    case 'session.status_idle':
      return event.stop_reason.type === 'requires_action' ? 'requires_input' : 'idle';
    case 'session.status_terminated':
      return 'terminated';
    default:
      return null;
  }
}
