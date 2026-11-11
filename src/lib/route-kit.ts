// API routes parse, call a feature and return; this boundary owns request
// context, error capture and the shared { error: { code, message } } response.
// Sibling .ts imports keep the module loadable by the Node test runner.

import { timingSafeEqual } from 'node:crypto';
import { after } from 'next/server';
import { z } from 'zod';
import { env } from './env';
import { AppError, CapabilityOffError, type ErrorCode } from './errors';
import { isExpectedUserStateError } from './expected-state-error';
import { shipLog } from './logger';
import { captureException, flushObservability } from './observability';
import { requireCtx, withRequestContext } from './request-context';
import { ROUTE_ERROR_MESSAGES, USER_COPY_CODES } from './route-error-messages';

// Listing every ErrorCode makes adding an unmapped error a compile failure.
const DEFAULT_STATUS_BY_CODE: Record<ErrorCode, number> = {
  // 400 — the request itself is malformed or fails validation.
  INVALID_BODY: 400,
  VALIDATION_FAILED: 400,
  TOOL_INPUT_INVALID: 400,
  // 401 — missing or invalid credentials / signature.
  UNAUTHENTICATED: 401,
  WEBHOOK_SIGNATURE_INVALID: 401,
  // 402 — out of credits, or at a plan limit.
  CREDITS_EXHAUSTED: 402,
  PLAN_LIMIT_REACHED: 402,
  // 403 — authenticated but not permitted.
  FORBIDDEN: 403,
  SKILL_LIMIT_EXCEEDED: 403,
  // privacy model: the caller can read this shared task but may not write
  // to it (task identity stays creator-only).
  SESSION_NOT_WRITABLE: 403,
  // 404 — the addressed resource does not exist (or is another tenant's, which
  // we deliberately render indistinguishable from missing).
  WORKSPACE_NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  ARTIFACT_NOT_FOUND: 404,
  TASK_NOT_FOUND: 404,
  TOOL_NOT_FOUND: 404,
  // 409 — the request conflicts with the resource's current state.
  SOLE_OWNER_BLOCKED: 409,
  LAST_WORKSPACE_BLOCKED: 409,
  SESSION_BUSY: 409,
  CONFLICT: 409,
  WORKSPACE_CHANGED: 409,
  MEMORY_EDIT_CONFLICT: 409,
  MEMORY_PATH_CONFLICT: 409,
  // 503 — a dependency is unconfigured or an upstream call failed; retry may help.
  INTEGRATION_NOT_CONNECTED: 503,
  EXTERNAL_API_FAILED: 503,
  DATABASE_UNAVAILABLE: 503,
  DEADLINE_REACHED: 503,
  // 500 — server-side faults with no better mapping.
  TOOL_HANDLER_FAILED: 500,
  UNEXPECTED: 500,
  // Client-side fetch failures (fetch-json.ts); if one ever reaches a route
  // boundary it is a server fault, not a client contract.
  API_REQUEST_FAILED: 500,
};

// Parse + validate a JSON request body against `schema`. Throws
// AppError('INVALID_BODY') (→400 via routeErrorResponse) when the body is not
// JSON or fails the schema — the caller trusts the returned value's type and
// never re-checks. This is the one body-parse path, so every bad body gets the same 400 shape.
export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch (cause) {
    // A body that isn't valid JSON is a client error, not a server fault.
    throw new AppError(
      'INVALID_BODY',
      'Request body was not valid JSON',
      { expectedState: true },
      { cause },
    );
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('INVALID_BODY', 'Request body failed validation', {
      expectedState: true,
      issues: parsed.error.flatten(),
    });
  }
  return parsed.data;
}

// The one query-string parse path. Repeated keys keep their last value, and a
// bad query is a client mistake, reported the same way as a bad body.
export function parseSearchParams<T>(request: Request, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    throw new AppError(
      'INVALID_BODY',
      'Query parameters failed validation',
      { expectedState: true, issues: parsed.error.flatten() },
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

// timingSafeEqual needs equal lengths, so a length mismatch rejects first.
function bearerMatches(header: string | null, secret: string): boolean {
  if (header === null) return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Cron routes stay closed until CRON_SECRET is configured.
export function assertCronRequest(request: Request): void {
  if (!env.CRON_SECRET || !bearerMatches(request.headers.get('authorization'), env.CRON_SECRET)) {
    throw new AppError('UNAUTHENTICATED', 'Unauthorized cron invocation', {
      url: new URL(request.url).pathname,
    });
  }
}

// Internal exception text stays in telemetry; only authored limit copy reaches callers.
export function routeErrorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    const status = DEFAULT_STATUS_BY_CODE[error.code];
    return Response.json(
      {
        error: {
          code: error.code,
          message:
            error instanceof CapabilityOffError || USER_COPY_CODES.has(error.code)
              ? error.message
              : ROUTE_ERROR_MESSAGES[error.code],
          ...(isExpectedUserStateError(error) ? { expectedState: true } : {}),
          // A member's own limit is not lifted by credits, so the browser must not offer them.
          ...(error.code === 'CREDITS_EXHAUSTED' && error.context.reason === 'member_limit'
            ? { reason: 'member_limit' }
            : {}),
        },
      },
      { status },
    );
  }
  return Response.json(
    { error: { code: 'UNEXPECTED', message: 'Unexpected error' } },
    { status: 500 },
  );
}

// The route boundary opens request context, schedules the observability flush
// and maps thrown errors to the shared response shape. AppErrors retain
// their mapped status; handlers return a Response.
export function withApiRoute(
  opts: {
    route: string;
    feature?: string;
    errorResponse?: (error: unknown) => Response;
    // Reports expected user-state errors too, for routes that move money.
    reportExpectedErrors?: boolean;
  },
  handler: (request: Request, routeCtx: { params?: unknown }) => Promise<Response>,
): (request: Request, routeCtx?: { params?: Promise<unknown> }) => Promise<Response> {
  return (request, routeCtx) =>
    withRequestContext({ route: opts.route, feature: opts.feature }, async () => {
      // Scheduled before the handler so it is registered even if the handler
      // throws; `after` runs the flush once the response is finished.
      const requestContext = requireCtx();
      after(() => withRequestContext(requestContext, flushObservability));
      try {
        return await handler(request, { params: routeCtx?.params });
      } catch (error) {
        const expected = isExpectedUserStateError(error);
        if (!expected || opts.reportExpectedErrors) captureException(error, { route: opts.route });
        // An expected refusal is a normal answer, so it logs below the error level.
        shipLog({
          level: expected ? 'info' : 'error',
          msg: 'route.failed',
          route: opts.route,
          error,
        });
        return (opts.errorResponse ?? routeErrorResponse)(error);
      }
    });
}

// Malformed route identifiers are expected client input failures, not incidents.
export async function parseRouteParams<T>(params: unknown, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await params);
  if (!parsed.success) {
    throw new AppError(
      'INVALID_BODY',
      'Route parameters failed validation',
      { expectedState: true, issues: parsed.error.flatten() },
      { cause: parsed.error },
    );
  }
  return parsed.data;
}
