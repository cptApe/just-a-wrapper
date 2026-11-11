'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useWorkspaceChannel } from '../hooks/use-workspace-channel';

// A stream that restarts past its replay window may have missed events, so every view refetches.
export function WorkspaceResync({
  organizationId,
  userId,
}: {
  organizationId: string | null;
  userId: string | null;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  useWorkspaceChannel(organizationId, userId, (event) => {
    if (event.type === 'resync') {
      void queryClient.invalidateQueries();
      router.refresh();
    }
  });
  return null;
}
