'use client';

// The list shows a save at once and rolls it back on failure, leaving the form open for a retry.
// PATCH returns only the saved version, so detail updates from the saved fields and that version.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useOrganizationId } from '@/components/providers/app-providers';
import type { TaskScheduledItem } from '@/features/tasks/types';
import { AppError } from '@/lib/errors';
import { isExpectedUserStateError } from '@/lib/expected-state-error';
import { optimisticMutation } from '@/lib/optimistic-mutation';
import { insertRowAtTop, patchRow, rekeyRow } from '../lib/scheduled-list-cache';
import { scheduledQueryKeys } from './keys';
import { saveTaskRequest } from './save-task-request';

type SaveVariables = Parameters<typeof saveTaskRequest>[0];

export function useSaveSchedule(onClose: () => void) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId();
  return useMutation({
    mutationFn: saveTaskRequest,
    ...optimisticMutation(queryClient, {
      root: organizationId ? scheduledQueryKeys.all(organizationId) : scheduledQueryKeys.unscoped(),
      apply: (vars: SaveVariables): string | null => {
        if (!organizationId) return null;
        const listKey = scheduledQueryKeys.list(organizationId);
        if (vars.kind === 'edit') {
          queryClient.setQueryData<TaskScheduledItem[]>(listKey, (old) =>
            patchRow(old, vars.taskId, vars.rowPatch),
          );
          return null;
        }
        const tempId = crypto.randomUUID();
        queryClient.setQueryData<TaskScheduledItem[]>(listKey, (old) =>
          insertRowAtTop(old, { ...vars.optimisticRow, id: tempId }),
        );
        return tempId;
      },
      // A 4xx the server explains is the user's to fix; only unexpected failures are captured.
      failure: (error) => ({
        message: 'Couldn’t save the schedule. Try again.',
        description: error instanceof AppError ? error.message : undefined,
        capture:
          isExpectedUserStateError(error) ||
          (error instanceof AppError && error.context.status !== undefined)
            ? undefined
            : { op: 'save-schedule' },
      }),
      settle: () => router.refresh(),
    }),
    onSuccess: (savedTask, vars, context) => {
      if (organizationId && vars.kind === 'edit') {
        queryClient.setQueryData(scheduledQueryKeys.detail(organizationId, vars.taskId), {
          ...vars.updatedEditable,
          version: savedTask.version ?? vars.updatedEditable.version,
        });
      }
      const { taskId } = savedTask;
      const tempId = context.applied;
      if (organizationId && tempId && taskId) {
        queryClient.setQueryData<TaskScheduledItem[]>(
          scheduledQueryKeys.list(organizationId),
          (old) => rekeyRow(old, tempId, taskId),
        );
      }
      toast.success(vars.successToast);
      onClose();
    },
  });
}
