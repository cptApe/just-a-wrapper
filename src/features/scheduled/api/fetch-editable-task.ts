// Keep detail fetching independent of the dialog bundle so row hover can prefetch it.

import { z } from 'zod';
import { editableTaskSchema } from '@/features/tasks/lib/editable-task-schema';
import { AppError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';

const editableTaskResponse = z.object({ task: editableTaskSchema });

export async function fetchEditableTask(taskId: string, signal?: AbortSignal) {
  const parsed = editableTaskResponse.safeParse(
    await fetchJson(`/api/tasks/${taskId}`, { signal }),
  );
  if (!parsed.success) {
    throw new AppError(
      'API_REQUEST_FAILED',
      'Invalid task configuration response',
      { taskId },
      { cause: parsed.error },
    );
  }
  return parsed.data.task;
}
