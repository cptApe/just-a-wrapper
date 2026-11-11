'use server';

import { headers } from 'next/headers';
import { type ActionState, runAction } from '@/lib/action-state';
import { workspaceActionBoundary } from '../lib/workspace-error-copy';
import { updateWorkspaceMemberRole } from './update-workspace-member-role';

// Only a failed provider call is an incident; every other AppError is a refusal the user can fix.
export async function updateWorkspaceMemberRoleAction(input: unknown): Promise<ActionState<void>> {
  return runAction(
    {
      ...workspaceActionBoundary('settings-members-update-role', 'role'),
      expected: (error) => error.code !== 'API_REQUEST_FAILED',
    },
    async () => updateWorkspaceMemberRole(input, await headers()),
  );
}
