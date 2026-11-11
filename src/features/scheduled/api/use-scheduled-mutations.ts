'use client';

// Rows change the moment a verb is chosen and roll back on failure. The list has no GET endpoint, so
// the refresh after the last write replaces rows with server truth instead of an invalidate.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useOrganizationId } from '@/components/providers/app-providers';
import type { TaskScheduledItem } from '@/features/tasks/types';
import { AppError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import { optimisticMutation } from '@/lib/optimistic-mutation';
import { pauseRow, removeRow, resumeRow } from '../lib/scheduled-list-cache';
import { scheduledQueryKeys } from './keys';

const ERROR_COPY = {
  pause: 'Couldn’t pause the schedule.',
  resume: 'Couldn’t resume the schedule.',
  run: 'Couldn’t start the run.',
  delete: 'Couldn’t delete the schedule.',
} as const;

const SUCCESS_COPY = {
  pause: 'Schedule paused',
  resume: 'Schedule resumed',
  run: 'Run started',
  delete: 'Schedule deleted',
} as const;

type Verb = keyof typeof ERROR_COPY;
type RowVerb = { taskId: string; verb: Verb };

// fetchJson puts HTTP status in AppError context; undefined means the request never reached the server.
function failureCopy(verb: Verb, error: unknown): string {
  const status = error instanceof AppError ? error.context.status : undefined;
  return status === undefined ? 'Couldn’t reach the server. Try again.' : ERROR_COPY[verb];
}

async function postAction(taskId: string, action: 'pause' | 'resume' | 'run'): Promise<void> {
  await fetchJson(`/api/tasks/${taskId}/${action}`, { method: 'POST' });
}

async function deleteTaskRequest(taskId: string): Promise<void> {
  await fetchJson(`/api/tasks/${taskId}`, { method: 'DELETE' });
}

const OPTIMISTIC_EDIT = { pause: pauseRow, resume: resumeRow, delete: removeRow } as const;

export type ScheduledRowMutations = {
  /** busy is true while ANY of this row's verbs is in flight (disables the controls). */
  busy: boolean;
  pause: (taskId: string) => void;
  resume: (taskId: string) => void;
  run: (taskId: string) => void;
  remove: (taskId: string) => void;
};

export function useScheduledMutations(): ScheduledRowMutations {
  const router = useRouter();
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId();
  const mutation = useMutation({
    mutationFn: async ({ taskId, verb }: RowVerb) => {
      if (verb === 'delete') await deleteTaskRequest(taskId);
      else await postAction(taskId, verb);
    },
    ...optimisticMutation(queryClient, {
      root: organizationId ? scheduledQueryKeys.all(organizationId) : scheduledQueryKeys.unscoped(),
      apply: ({ taskId, verb }: RowVerb) => {
        if (!organizationId || verb === 'run') return;
        queryClient.setQueryData<TaskScheduledItem[]>(
          scheduledQueryKeys.list(organizationId),
          (old) => OPTIMISTIC_EDIT[verb](old, taskId),
        );
      },
      failure: (error, { taskId, verb }) => ({
        message: failureCopy(verb, error),
        capture: { op: `task-${verb}`, taskId },
      }),
      settle: () => router.refresh(),
    }),
    onSuccess: (_response, { taskId, verb }) => {
      // Every verb moves the task's version, so the edit form must read it again.
      if (organizationId)
        void queryClient.invalidateQueries({
          queryKey: scheduledQueryKeys.detail(organizationId, taskId),
        });
      toast.success(SUCCESS_COPY[verb]);
    },
  });
  return {
    busy: mutation.isPending,
    pause: (taskId) => mutation.mutate({ taskId, verb: 'pause' }),
    resume: (taskId) => mutation.mutate({ taskId, verb: 'resume' }),
    run: (taskId) => mutation.mutate({ taskId, verb: 'run' }),
    remove: (taskId) => mutation.mutate({ taskId, verb: 'delete' }),
  };
}
