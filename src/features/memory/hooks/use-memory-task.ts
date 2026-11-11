'use client';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { useOrganizationId } from '@/components/providers/app-providers';
import type { ActionState } from '@/lib/action-state';
import { reloadWorkspaceChanged } from '@/lib/reload-workspace-changed';
import type { MemoryScope } from '../types';

/** Starts the memory update task; the library page passes it in because it starts a session. */
export type AskAgentToUpdateMemory = (
  scope: MemoryScope,
  expectedOrganizationId: string,
) => Promise<ActionState<{ sessionId: string }>>;

export function useMemoryTask(
  scope: MemoryScope | null,
  askAgentToUpdateMemory: AskAgentToUpdateMemory,
) {
  const router = useRouter();
  const expectedOrganizationId = useOrganizationId();
  const [pending, startTransition] = React.useTransition();
  function askAgent() {
    if (pending || expectedOrganizationId === null) return;
    startTransition(async () => {
      const res = await askAgentToUpdateMemory(scope ?? 'you', expectedOrganizationId);
      if (!res.ok) {
        if (reloadWorkspaceChanged({ code: res.code })) return;
        toast.error('Couldn’t start the task', { description: res.message });
        return;
      }
      router.push(`/app/task/${res.data.sessionId}`);
    });
  }

  return { pending, askAgent };
}
