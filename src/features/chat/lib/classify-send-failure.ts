import { CREDITS_EXHAUSTED_MESSAGE, MEMBER_LIMIT_MESSAGE } from '@/lib/credits-copy';
import { AppError, BillingError, type ErrorCode } from '@/lib/errors';
import { AWAITING_TOOL_RESULT_MESSAGE, ROUTE_ERROR_MESSAGES } from '@/lib/route-error-messages';

export const TASK_SEND_FAILED_MESSAGE = 'Could not send. Try again in a moment.';

/** What a failed send or create means to a composer. Every kind with a sentence carries one a person can read. */
export type SendFailure =
  | { kind: 'credits-exhausted'; message: string }
  /** The member's own credit limit: only an admin can lift it, so no credits are offered. */
  | { kind: 'member-limit'; message: string }
  | { kind: 'plan-limit'; message: string }
  | { kind: 'awaiting-tool-result'; message: string }
  | { kind: 'attachments-failed'; message: string }
  | { kind: 'upstream'; message: string }
  | { kind: 'other' };

// A refusal reaches the browser two ways: create-session rethrows a 402 as a typed BillingError,
// and fetch-json carries the route's code in context.serverCode.
function isRefusal(error: AppError, code: ErrorCode): boolean {
  return (
    (error instanceof BillingError && error.code === code) || error.context.serverCode === code
  );
}

/**
 * The sentence the server wrote for this failure, or the fallback. A failed fetch's own
 * message is a status line for logs ("POST … failed (402)") and never reaches a person.
 */
function serverSentence(error: AppError, fallback: string): string {
  const { serverMessage } = error.context;
  if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  // create-session builds its BillingError from the server's sentence.
  if (error instanceof BillingError && error.message.length > 0) return error.message;
  return fallback;
}

// An Anthropic outage or a stale workspace arrives with the server's own sentence, already captured.
function upstreamMessage(error: AppError): string | null {
  const { serverCode } = error.context;
  if (serverCode !== 'EXTERNAL_API_FAILED' && serverCode !== 'WORKSPACE_CHANGED') return null;
  const message = serverSentence(error, '');
  return message.length > 0 ? message : null;
}

export function classifySendFailure(error: unknown): SendFailure {
  if (!(error instanceof AppError)) return { kind: 'other' };
  if (isRefusal(error, 'CREDITS_EXHAUSTED')) {
    if (error.context.serverReason === 'member_limit')
      return { kind: 'member-limit', message: serverSentence(error, MEMBER_LIMIT_MESSAGE) };
    return { kind: 'credits-exhausted', message: serverSentence(error, CREDITS_EXHAUSTED_MESSAGE) };
  }
  if (isRefusal(error, 'PLAN_LIMIT_REACHED'))
    return {
      kind: 'plan-limit',
      message: serverSentence(error, ROUTE_ERROR_MESSAGES.PLAN_LIMIT_REACHED),
    };
  if (error.context.serverCode === 'AWAITING_TOOL_RESULT')
    return {
      kind: 'awaiting-tool-result',
      message: serverSentence(error, AWAITING_TOOL_RESULT_MESSAGE),
    };
  // send-with-attachments writes this sentence itself from each file's failure.
  if (Array.isArray(error.context.failed))
    return { kind: 'attachments-failed', message: error.message };
  const message = upstreamMessage(error);
  return message === null ? { kind: 'other' } : { kind: 'upstream', message };
}

/** The sentence under the task Composer for a failed send, or null when a banner or bubble explains it. */
export function taskComposerFailureMessage(error: unknown): string | null {
  if (
    error instanceof AppError &&
    error.code === 'VALIDATION_FAILED' &&
    error.context.reason === 'message-too-long'
  )
    return error.message;
  const failure = classifySendFailure(error);
  switch (failure.kind) {
    case 'credits-exhausted':
    case 'member-limit':
    case 'plan-limit':
    case 'awaiting-tool-result':
      return null;
    case 'upstream':
      return failure.message;
    case 'attachments-failed':
    case 'other':
      return TASK_SEND_FAILED_MESSAGE;
  }
}
