'use server';

import { headers } from 'next/headers';
import { type ActionState, runAction } from '@/lib/action-state';
import { workspaceActionBoundary } from '../lib/workspace-error-copy';
import { removeWorkspaceMember } from './remove-workspace-member';

// Only a failed provider call is an incident; every other AppError is a refusal the user can fix.
export async function removeWorkspaceMemberAction(input: unknown): Promise<ActionState<void>> {
  return runAction(
    {
      ...workspaceActionBoundary('settings-members-remove', 'remove'),
      expected: (error) => error.code !== 'API_REQUEST_FAILED',
    },
    async () => removeWorkspaceMember(input, await headers()),
  );
}
