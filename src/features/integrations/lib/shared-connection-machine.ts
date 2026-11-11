import { defineStateMachine } from '@/lib/state-machine';

// A row is deleted once its Composio account is gone, so `removing` has no way out but deletion.
export const sharedConnectionMachine = defineStateMachine('shared connection', {
  pending: ['pending', 'active', 'removing'],
  active: ['removing'],
  removing: ['removing'],
});

/** The Composio user that owns a workspace's shared accounts, so they outlive any one member's id. */
export function workspaceConnectionOwnerId(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}
