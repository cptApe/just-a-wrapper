import { defineStateMachine } from '@/lib/state-machine';

export const connectionMachine = defineStateMachine('connection', {
  disconnected: ['disconnected', 'connected', 'disconnecting'],
  connected: ['connected', 'disconnected', 'disconnecting'],
  disconnecting: ['disconnecting', 'disconnected'],
});

export type ConnectionEdge = 'connected' | 'disconnected' | 'unchanged';

export function connectionEdge(
  existing: { status: 'connected' | 'disconnected' | 'disconnecting' } | undefined,
  connected: boolean,
): ConnectionEdge {
  const from = existing === undefined ? 'disconnected' : existing.status;
  const to = connected ? 'connected' : 'disconnected';
  if (from === to || from === 'disconnecting') return 'unchanged';
  return to;
}
