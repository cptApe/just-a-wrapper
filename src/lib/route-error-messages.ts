import type { ErrorCode } from './errors';

// Routes never expose provider configuration, persistence details or raw exception text.
export const ROUTE_ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_BODY: 'The request is invalid. Check your input and try again.',
  VALIDATION_FAILED: 'The request is invalid. Check your input and try again.',
  TOOL_INPUT_INVALID: 'The tool input is invalid.',
  UNAUTHENTICATED: 'Sign in to continue.',
  WEBHOOK_SIGNATURE_INVALID: 'The request could not be verified.',
  CREDITS_EXHAUSTED: 'You have reached your credit limit.',
  PLAN_LIMIT_REACHED: 'You have reached a workspace limit.',
  FORBIDDEN: 'You do not have permission to do this.',
  SKILL_LIMIT_EXCEEDED: 'You have reached your skill limit.',
  SESSION_NOT_WRITABLE: 'Only the task owner can modify this task.',
  WORKSPACE_NOT_FOUND: 'Workspace not found',
  SESSION_NOT_FOUND: 'Session not found',
  ARTIFACT_NOT_FOUND: 'File not found.',
  TASK_NOT_FOUND: 'Task not found.',
  TOOL_NOT_FOUND: 'Tool not found.',
  SOLE_OWNER_BLOCKED: 'Choose another owner before leaving.',
  LAST_WORKSPACE_BLOCKED: 'You must belong to at least one workspace.',
  SESSION_BUSY: 'This chat is still working. Try again when it finishes.',
  WORKSPACE_CHANGED: 'Your workspace changed. Reload before trying again.',
  CONFLICT: 'This request conflicts with a recent change. Refresh and try again.',
  MEMORY_EDIT_CONFLICT: 'This memory changed. Refresh before editing it.',
  MEMORY_PATH_CONFLICT: 'A memory already exists at this path.',
  INTEGRATION_NOT_CONNECTED: 'Reconnect the app to continue.',
  EXTERNAL_API_FAILED: 'The AI service is unavailable right now. Try again in a moment.',
  DATABASE_UNAVAILABLE: 'This chat is unavailable right now. Try again in a moment.',
  DEADLINE_REACHED: 'This took too long to finish. Try again in a moment.',
  TOOL_HANDLER_FAILED: 'The tool could not complete this request.',
  UNEXPECTED: 'Unexpected error',
  API_REQUEST_FAILED: 'The request could not be completed. Try again.',
};

// A send refused while a tool waits for the person's approval. Routes answer it with its own
// code, AWAITING_TOOL_RESULT, which is not an ErrorCode.
export const AWAITING_TOOL_RESULT_MESSAGE =
  'This chat is waiting for your approval on a tool. Approve or deny it first.';

// Limit refusals carry copy billing writes for the user: the limit, or the top-up that lifts it.
// Route boundaries send that message as written instead of the generic one above.
export const USER_COPY_CODES: ReadonlySet<ErrorCode> = new Set([
  'CREDITS_EXHAUSTED',
  'PLAN_LIMIT_REACHED',
  'SKILL_LIMIT_EXCEEDED',
]);
