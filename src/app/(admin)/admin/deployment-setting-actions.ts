'use server';

import { revalidatePath } from 'next/cache';
import { type ActionState, runAction } from '@/lib/action-state';
import { isDeploymentSettingKey } from '@/lib/deployment-settings/registry';
import { writeDeploymentSetting } from '@/lib/deployment-settings/store';
import { AppError } from '@/lib/errors';
import { requireAdminActor } from '../admin-access';

/**
 * The one write path for deployment settings from the admin console. Null clears the stored value
 * so the environment variable applies again. The store validates the value against its key.
 */
export async function updateDeploymentSettingAction(
  key: string,
  value: unknown,
): Promise<ActionState<void>> {
  return runAction(
    {
      route: 'admin/deployment-settings',
      feature: 'admin',
      message: 'Could not save this setting. Try again.',
      expected: (error) => error.code === 'VALIDATION_FAILED' || error.code === 'FORBIDDEN',
    },
    async () => {
      const actor = await requireAdminActor();
      if (!isDeploymentSettingKey(key))
        throw new AppError('VALIDATION_FAILED', 'That setting does not exist.', { key });
      await writeDeploymentSetting({ key, value, actorUserId: actor.userId });
      // Every page reads settings on its next render; the admin pages show the new value now.
      revalidatePath('/admin', 'layout');
    },
  );
}
