// Typed errors preserve server diagnostics; route boundaries select safe client messages.
import { z } from 'zod';
import { sanitize } from './sanitize';
export const ERROR_CODES = [
  'TOOL_INPUT_INVALID',
  'TOOL_NOT_FOUND',
  'TOOL_HANDLER_FAILED',
  'INTEGRATION_NOT_CONNECTED',
  'CREDITS_EXHAUSTED',
  // The workspace is at one of its plan's limits (chats running at once,
  // scheduled tasks). Same 402 as the credits gate: the request is well formed
  // and the caller is allowed, they are just at a workspace limit.
  'PLAN_LIMIT_REACHED',
  'WEBHOOK_SIGNATURE_INVALID',
  'WORKSPACE_NOT_FOUND',
  'CONFLICT',
  'WORKSPACE_CHANGED',
  'SKILL_LIMIT_EXCEEDED',
  'SESSION_NOT_FOUND',
  // An editor save lost an optimistic-concurrency race. Reload before retrying.
  'MEMORY_EDIT_CONFLICT',
  // A memory create or rename targeted a path that another note already owns.
  'MEMORY_PATH_CONFLICT',
  // A message could not be posted because the session's turn is still in flight
  // (the Anthropic Sessions API rejects a new user.message while it is waiting on
  // tool responses). Retryable once the turn goes idle → HTTP 409.
  'SESSION_BUSY',
  // The caller can read the session but fails the required write permission. Maps to 403.
  'SESSION_NOT_WRITABLE',
  'ARTIFACT_NOT_FOUND',
  'TASK_NOT_FOUND',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'VALIDATION_FAILED',
  // Request body was absent, not JSON, or failed its route schema. Thrown by
  // parseJsonBody at the route boundary; maps to 400 (src/lib/route-kit.ts).
  'INVALID_BODY',
  // You are the workspace's only owner; leaving would orphan it, so make
  // someone else an owner first (Settings/Workspace, Danger zone, Leave).
  'SOLE_OWNER_BLOCKED',
  // You must always belong to at least one workspace, so the last one can be
  // neither left nor deleted (Settings/Workspace, Danger zone).
  'LAST_WORKSPACE_BLOCKED',
  'EXTERNAL_API_FAILED',
  // The application's own Postgres did not answer — unreachable, or too slow to
  // wait for. Distinct from EXTERNAL_API_FAILED, which names a third party.
  'DATABASE_UNAVAILABLE',
  'API_REQUEST_FAILED',
  // A background sweep ran out of time; unfinished rows resume on the next run.
  'DEADLINE_REACHED',
  'UNEXPECTED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  // `declare` fields (NOT constructor parameter properties) so this module is
  // importable by the `node --test` runner, which type-STRIPS .ts and rejects
  // parameter properties (they need transformation, not just stripping). The
  // values are assigned in the constructor; `declare` emits no runtime field,
  // so those assignments are the sole source of truth (behaviour is identical).
  declare readonly code: ErrorCode;
  declare readonly context: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    context: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.code = code;
    this.context = context;
    this.name = 'AppError';
  }
}

export class ToolError extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    context: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(code, message, context, options);
    this.name = 'ToolError';
  }
}

export class IntegrationError extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    context: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(code, message, context, options);
    this.name = 'IntegrationError';
  }
}

// A feature is off because a setting is missing. The message comes from
// capability-messages.ts and names the setting, so route boundaries may send it to the caller.
// A feature this deployment turned off. The refusal is the expected answer, not an incident.
export class CapabilityOffError extends IntegrationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('INTEGRATION_NOT_CONNECTED', message, { ...context, expectedState: true });
    this.name = 'CapabilityOffError';
  }
}

export class BillingError extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    context: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(code, message, context, options);
    this.name = 'BillingError';
  }
}

export class WebhookError extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    context: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(code, message, context, options);
    this.name = 'WebhookError';
  }
}

// The caller is authenticated but not permitted to perform this action (e.g. a
// non-admin member editing the workspace memory store, or a non-creator trying to
// write to a shared task). Defaults to the `FORBIDDEN` code; pass a more specific
// forbidden-family code (e.g. `SESSION_NOT_WRITABLE`) when the boundary maps it to
// a distinct wire code. Either way route/action boundaries map it to a 403.
export class AuthorizationError extends AppError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    options: { cause?: unknown; code?: ErrorCode } = {},
  ) {
    super(options.code ?? 'FORBIDDEN', message, context, options);
    this.name = 'AuthorizationError';
  }
}

export function serializeError(err: unknown): Record<string, unknown> {
  return sanitize(err instanceof Error ? err : { value: err });
}

// Preserve native Error shape for error tracker grouping without handing the
// SDK the original object, whose causes and custom fields may contain secrets.
export function exceptionFromRecord(record: Record<string, unknown>): Error {
  const error = new Error(typeof record.message === 'string' ? record.message : 'Non-Error thrown');
  Object.assign(error, record);
  if (record.cause && typeof record.cause === 'object' && !Array.isArray(record.cause)) {
    error.cause = exceptionFromRecord(z.record(z.string(), z.unknown()).parse(record.cause));
  }
  return error;
}

export class PortalUnavailableError extends BillingError {
  constructor(workspaceId: string, cause: unknown) {
    super('EXTERNAL_API_FAILED', 'Billing portal is unavailable', { workspaceId }, { cause });
    this.name = 'PortalUnavailableError';
  }
}
