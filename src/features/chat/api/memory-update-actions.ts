'use server';
import { headers } from 'next/headers';
import {
  MEMORY_ACTION_FAILED_MESSAGE,
  memoryErrorMessage,
} from '@/features/memory/api/memory-errors';
import { resolveEditableStore } from '@/features/memory/api/store-access';
import type { MemoryScope } from '@/features/memory/types';
import { type ActionState, runAction } from '@/lib/action-state';
import { assertExpectedOrganization } from '@/lib/assert-expected-organization';
import { startMemoryUpdateTask } from './memory-update-task';

export async function askAgentToUpdateMemory(
  scope: MemoryScope,
  expectedOrganizationId: string,
): Promise<ActionState<{ sessionId: string }>> {
  return runAction(
    {
      route: 'memory/ask-agent',
      feature: 'memory',
      message: MEMORY_ACTION_FAILED_MESSAGE,
      appErrorMessage: memoryErrorMessage,
    },
    async () => {
      // Members may not edit workspace memory themselves — and their sessions
      // attach the workspace store read-only, so the task would be a dead end.
      const scoped = await resolveEditableStore(await headers(), scope);
      assertExpectedOrganization(scoped.ctx.organizationId, expectedOrganizationId);
      return startMemoryUpdateTask(scope, scoped.ctx);
    },
  );
}
