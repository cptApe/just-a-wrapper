// Client-owned copy keeps provider details out of the schedule form.
// Creation needs a task ID to reconcile the optimistic row; an edit returns the version it saved.

import { z } from 'zod';
import type { SaveVars } from '@/features/tasks/types';
import { AppError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';

const createdTaskSchema = z.object({ taskId: z.string().min(1) });
const editedTaskSchema = z.object({ version: z.number().int() });
const serverErrorSchema = z.object({
  status: z.number().optional(),
  serverCode: z.string().optional(),
});

const SAVE_ERROR_COPY: Readonly<{ UNEXPECTED: string; [code: string]: string }> = {
  INVALID_BODY: 'Check the schedule details and try again.',
  VALIDATION_FAILED: 'Check the schedule details and try again.',
  TOOL_INPUT_INVALID: 'Check the schedule time, timezone and instructions.',
  CONFLICT: 'This schedule changed somewhere else. Reload to see the latest version.',
  PLAN_LIMIT_REACHED: 'Your schedule limit is reached. Pause a schedule to add another.',
  CREDITS_EXHAUSTED: 'Add credits to save this schedule.',
  INTEGRATION_NOT_CONNECTED: 'Scheduling isn’t configured in this environment.',
  EXTERNAL_API_FAILED: 'Scheduling isn’t configured in this environment.',
  DATABASE_UNAVAILABLE: 'Scheduling isn’t configured in this environment.',
  NETWORK: 'Couldn’t reach the server. Try again.',
  UNEXPECTED: 'Couldn’t save it. Try again.',
};

export async function saveTaskRequest(
  values: SaveVars,
): Promise<{ taskId?: string; version?: number }> {
  const url = `/api/tasks${values.kind === 'edit' ? `/${values.taskId}` : ''}`;
  const request = {
    method: values.kind === 'edit' ? 'PATCH' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(values.body),
  };
  let response: unknown;
  try {
    response = await fetchJson(url, request);
  } catch (cause) {
    if (!(cause instanceof AppError)) throw cause;
    const context = serverErrorSchema.parse(cause.context);
    const code = context.status === undefined ? 'NETWORK' : (context.serverCode ?? 'UNEXPECTED');
    const message = SAVE_ERROR_COPY[code] ?? SAVE_ERROR_COPY.UNEXPECTED;
    throw new AppError('API_REQUEST_FAILED', message, cause.context, { cause });
  }
  const parsed = (values.kind === 'edit' ? editedTaskSchema : createdTaskSchema).safeParse(
    response,
  );
  if (!parsed.success)
    throw new AppError(
      'API_REQUEST_FAILED',
      SAVE_ERROR_COPY.UNEXPECTED,
      {
        op: values.kind === 'edit' ? 'edit-task-missing-version' : 'create-task-missing-id',
        status: 200,
      },
      { cause: parsed.error },
    );
  return parsed.data;
}
