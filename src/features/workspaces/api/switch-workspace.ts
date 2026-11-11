'use server';

import { headers } from 'next/headers';
import { type ActionState, runAction } from '@/lib/action-state';
import { activateOrganization } from './active-organization-transitions';

const SWITCH_FAILED_MESSAGE = 'Could not switch workspace. Please try again.';

export async function switchWorkspace(organizationId: string): Promise<ActionState<void>> {
  return runAction(
    {
      route: 'switch-workspace',
      op: 'switch-workspace',
      feature: 'workspaces',
      message: SWITCH_FAILED_MESSAGE,
      appErrorMessage: () => SWITCH_FAILED_MESSAGE,
    },
    async () => activateOrganization(await headers(), organizationId),
  );
}
