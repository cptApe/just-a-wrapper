import { defineStateMachine } from '@/lib/state-machine';

export type BrowserStatus = 'active' | 'user' | 'acting' | 'closing' | 'closed' | 'ended';
export const browserMachine = defineStateMachine<BrowserStatus>('task browser', {
  active: ['user', 'acting', 'closing', 'ended'],
  user: ['active', 'closing', 'ended'],
  acting: ['user', 'active', 'closing', 'ended'],
  closing: ['closed', 'ended'],
  closed: [],
  ended: [],
});
export const LIVE_BROWSER_STATES: BrowserStatus[] = ['active', 'user', 'acting', 'closing'];
export const BROWSER_CONTROL_LEASE_MS = 300_000;
export const BROWSER_ACTION_LEASE_MS = 300_000;

// A different provider identity starts a new lifecycle; a terminal identity never reopens.
export const NEW_BROWSER_SOURCES: BrowserStatus[] = ['closed', 'ended'];
export function browserControlIsLive(
  status: BrowserStatus | null,
  lease: Date | null,
  now: number,
): boolean {
  return status === 'user' && lease !== null && lease.getTime() > now;
}
