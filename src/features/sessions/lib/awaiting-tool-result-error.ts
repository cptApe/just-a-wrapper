import { APIError } from '@anthropic-ai/sdk';

// Managed Sessions rejects user.message while a custom-tool result is pending
// with invalid_request_error naming allowed result events. Match narrowly so
// unrelated 400 responses retain normal error handling.
export function isAwaitingToolResultError(error: unknown): boolean {
  return (
    error instanceof APIError &&
    error.status === 400 &&
    error.type === 'invalid_request_error' &&
    typeof error.message === 'string' &&
    error.message.includes('waiting on responses to events') &&
    error.message.includes('user.custom_tool_result')
  );
}
