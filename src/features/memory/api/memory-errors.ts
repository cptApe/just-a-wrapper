import { CREDITS_EXHAUSTED_MESSAGE } from '@/lib/credits-copy';
import type { AppError } from '@/lib/errors';
import { MEMORY_EDIT_CONFLICT_MESSAGE, WORKSPACE_MEMORY_ADMIN_ONLY_MESSAGE } from '../constants';

export const MEMORY_ACTION_FAILED_MESSAGE = 'Couldn’t reach the memory store. Please try again.';

// Client-safe messages keyed off the error code — raw internals never leak.
export function memoryErrorMessage(error: AppError): string {
  switch (error.code) {
    case 'FORBIDDEN':
      return WORKSPACE_MEMORY_ADMIN_ONLY_MESSAGE;
    case 'INTEGRATION_NOT_CONNECTED':
      return 'Memory isn’t available yet. The store hasn’t been provisioned.';
    case 'CREDITS_EXHAUSTED':
      // The ask-agent path starts a task, which the credits gate refuses
      // on an exhausted workspace.
      return CREDITS_EXHAUSTED_MESSAGE;
    case 'MEMORY_EDIT_CONFLICT':
      return MEMORY_EDIT_CONFLICT_MESSAGE;
    case 'MEMORY_PATH_CONFLICT':
      return 'Another note took that name. Choose a different name for that note, then try again.';
    case 'TOOL_INPUT_INVALID':
      return error.message;
    default:
      return MEMORY_ACTION_FAILED_MESSAGE;
  }
}
