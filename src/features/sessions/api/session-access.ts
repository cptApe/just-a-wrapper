import 'server-only';
import { APIError } from '@anthropic-ai/sdk';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';
import { type Caller, resolveCaller } from '@/lib/caller';
import { AppError, AuthorizationError } from '@/lib/errors';
import { extend } from '@/lib/request-context';
import { AWAITING_TOOL_RESULT_MESSAGE, ROUTE_ERROR_MESSAGES } from '@/lib/route-error-messages';
import { routeErrorResponse } from '@/lib/route-kit';
import { sessionVisibleToViewer } from './session-visibility';

export { sessionVisibleToViewer };

// Every session route authorizes here. A read grant admits viewers of the task; a write grant
// also proves the caller created it. Routes and payloads use the local uuid; only server callers
// receive the Anthropic id.

// Invalid UUIDs return the same 404 as unknown sessions instead of leaking a database parsing
// error.
const sessionIdSchema = z.uuid();

export function parseSessionId(raw: string): string {
  const parsed = sessionIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('SESSION_NOT_FOUND', 'Session not found', { sessionId: raw });
  }
  return parsed.data;
}

/** Non-throwing variant for the read-only page loaders that degrade to null. */
export function safeParseSessionId(raw: string): string | null {
  return sessionIdSchema.safeParse(raw).data ?? null;
}

export type WorkspaceSession = {
  sessionRowId: string;
  /** The row's Anthropic session id, or null before the upstream session exists. */
  anthropicSessionId: string | null;
  permissionMode: 'ask' | 'auto';
  // The creator owns the connections and tool_permission rows governing the agent’s gates.
  createdByUserId: string;
  /** Privacy of the row: 'private' (creator-only) or 'workspace'. */
  visibility: 'private' | 'workspace';
  /** Null only before the first user event has been observed locally. */
  lastEventAt: Date | null;
};

export type CallerSession = Caller & WorkspaceSession;
type AttachableSession = WorkspaceSession & { anthropicSessionId: string };

/** The caller may read this session's transcript and attach to its stream. */
export type SessionReadGrant = Caller & AttachableSession;

declare const writeGrantBrand: unique symbol;
/** The caller created this session and may steer it. Only authorizeSessionWrite issues one. */
export type SessionWriteGrant = SessionReadGrant & { readonly [writeGrantBrand]: true };

/** A live row of the workspace, with no viewer check; callers apply visibility themselves. */
export function loadWorkspaceSession(input: {
  sessionId: string;
  workspaceId: string;
}): Promise<WorkspaceSession> {
  return selectSession(input, null);
}

/** Transcript reads and relay attaches. */
export async function authorizeSessionAccess(input: {
  sessionId: string;
  headers: Headers;
}): Promise<SessionReadGrant> {
  const session = await resolveVisibleSession(input);
  return { ...session, anthropicSessionId: requireUpstream(session, input.sessionId) };
}

/** Conversation writes: send, interrupt, resume, tool approvals, feedback and browser control. */
export async function authorizeSessionWrite(input: {
  sessionId: string;
  headers: Headers;
}): Promise<SessionWriteGrant> {
  const session = await resolveVisibleSession(input);
  const anthropicSessionId = requireUpstream(session, input.sessionId);
  requireCreator(session.userId, session, input.sessionId);
  const checked: SessionReadGrant = { ...session, anthropicSessionId };
  // The brand exists only in the type, so this cast is the one place a write grant is issued.
  return checked as SessionWriteGrant;
}

/** Identity writes (rename / pin / delete) stay creator-only and work before the upstream exists. */
export async function authorizeSessionIdentityWrite(input: {
  sessionId: string;
  headers: Headers;
}): Promise<CallerSession> {
  const session = await resolveVisibleSession(input);
  requireCreator(session.userId, session, input.sessionId);
  return session;
}

/** Conversation writes by an actor resolved elsewhere, such as an upload's attachment mount. */
export async function authorizeSessionWriteForActor(input: {
  sessionId: string;
  workspaceId: string;
  userId: string;
}): Promise<AttachableSession> {
  const session = await loadWorkspaceSession(input);
  const anthropicSessionId = requireUpstream(session, input.sessionId, input.workspaceId);
  requireCreator(input.userId, session, input.sessionId);
  return { ...session, anthropicSessionId };
}

async function resolveVisibleSession(input: {
  sessionId: string;
  headers: Headers;
}): Promise<CallerSession> {
  const caller = await resolveCaller(input.headers);
  extend({ session_id: input.sessionId });
  // Private tasks owned by someone else look missing, through the shared read predicate.
  const session = await selectSession(
    { sessionId: input.sessionId, workspaceId: caller.workspaceId },
    caller.userId,
  );
  return { ...caller, ...session };
}

async function selectSession(
  input: { sessionId: string; workspaceId: string },
  viewerId: string | null,
): Promise<WorkspaceSession> {
  const sessionId = parseSessionId(input.sessionId);
  const row = (
    await db
      .select({
        sessionRowId: sessionTable.id,
        anthropicSessionId: sessionTable.anthropicSessionId,
        permissionMode: sessionTable.permissionMode,
        createdByUserId: sessionTable.createdByUserId,
        visibility: sessionTable.visibility,
        lastEventAt: sessionTable.lastEventAt,
      })
      .from(sessionTable)
      .where(
        and(
          eq(sessionTable.id, sessionId),
          isNull(sessionTable.hiddenAt),
          eq(sessionTable.workspaceId, input.workspaceId),
          viewerId === null ? undefined : sessionVisibleToViewer(viewerId),
        ),
      )
      .limit(1)
  ).at(0);
  if (!row) {
    throw new AppError('SESSION_NOT_FOUND', 'Session not found', {
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
    });
  }
  return row;
}

// A session without an upstream id is not attachable and returns the same 404 as a missing one.
function requireUpstream(
  session: WorkspaceSession & { workspaceId?: string },
  sessionId: string,
  workspaceId = session.workspaceId,
): string {
  if (session.anthropicSessionId) return session.anthropicSessionId;
  throw new AppError('SESSION_NOT_FOUND', 'Session not found', { sessionId, workspaceId });
}

// Shared tasks expose the transcript, never control of the creator's private resources.
function requireCreator(userId: string, session: WorkspaceSession, sessionId: string): void {
  if (session.createdByUserId === userId) return;
  throw new AuthorizationError(
    'Only the task owner can modify this task',
    { sessionId, userId },
    { code: 'SESSION_NOT_WRITABLE' },
  );
}

// Task pages redirect sesn_ links and notification payloads to the UUID URL; null when absent in the workspace.
export async function resolveSessionUuidByAnthropicId(input: {
  anthropicSessionId: string;
  workspaceId: string;
}): Promise<string | null> {
  const row = (
    await db
      .select({ id: sessionTable.id })
      .from(sessionTable)
      .where(
        and(
          eq(sessionTable.anthropicSessionId, input.anthropicSessionId),
          eq(sessionTable.workspaceId, input.workspaceId),
        ),
      )
      .limit(1)
  ).at(0);
  return row?.id ?? null;
}

// Expose retryable upstream outages in plain language, not deployment credentials or billing state.
// Error capture retains diagnostics for the deployment owner.
export const UPSTREAM_BUSY_MESSAGE = 'The AI service is busy right now. Try again in a moment.';
export const UPSTREAM_UNAVAILABLE_MESSAGE = ROUTE_ERROR_MESSAGES.EXTERNAL_API_FAILED;

// Anthropic refuses an account with no API credits as a 400 invalid_request_error
// ("Your credit balance is too low to access the Anthropic API…"), not as a
// billing_error, so the status alone cannot tell it from a malformed request.
const CREDIT_BALANCE_REFUSAL = /credit balance/i;

// Distinguish retryable Anthropic outages from malformed requests. Also recognize API errors
// wrapped in EXTERNAL_API_FAILED.
function upstreamFailureMessage(error: unknown): string | null {
  if (error instanceof AppError) {
    if (error.code !== 'EXTERNAL_API_FAILED' || !(error.cause instanceof APIError)) return null;
    return upstreamFailureMessage(error.cause);
  }
  if (!(error instanceof APIError)) return null;
  // No status: APIConnectionError / APIConnectionTimeoutError (no response).
  if (error.status === undefined) return UPSTREAM_UNAVAILABLE_MESSAGE;
  if (error.status === 429 || error.status === 529 || error.type === 'overloaded_error') {
    return UPSTREAM_BUSY_MESSAGE;
  }
  if (error.status >= 500) return UPSTREAM_UNAVAILABLE_MESSAGE;
  if (error.status === 401 || error.status === 403) return UPSTREAM_UNAVAILABLE_MESSAGE;
  if (error.type === 'billing_error' || CREDIT_BALANCE_REFUSAL.test(error.message)) {
    return UPSTREAM_UNAVAILABLE_MESSAGE;
  }
  return null;
}

// Keep session error responses generic so resource existence never leaks. The route boundary owns
// error capture.
export function sessionRouteErrorResponse(error: unknown): Response {
  const upstreamMessage = upstreamFailureMessage(error);
  if (upstreamMessage) {
    return Response.json(
      { error: { code: 'EXTERNAL_API_FAILED', message: upstreamMessage } },
      { status: 503 },
    );
  }
  if (
    error instanceof AppError &&
    error.code === 'SESSION_BUSY' &&
    error.context.reason === 'send-unconfirmed'
  )
    return Response.json(
      {
        error: {
          code: 'SEND_UNCONFIRMED',
          message: 'Message delivery is still being confirmed. Retry to check again.',
        },
      },
      { status: 409 },
    );
  if (
    error instanceof AppError &&
    error.code === 'SESSION_BUSY' &&
    error.context.reason === 'awaiting-tool-result'
  ) {
    return Response.json(
      {
        error: {
          code: 'AWAITING_TOOL_RESULT',
          message: AWAITING_TOOL_RESULT_MESSAGE,
        },
      },
      { status: 409 },
    );
  }
  if (
    error instanceof AppError &&
    (error.code === 'SESSION_NOT_FOUND' || error.code === 'WORKSPACE_NOT_FOUND')
  ) {
    // Missing and inaccessible sessions share one response so existence never leaks.
    return Response.json(
      { error: { code: 'SESSION_NOT_FOUND', message: ROUTE_ERROR_MESSAGES.SESSION_NOT_FOUND } },
      { status: 404 },
    );
  }
  return routeErrorResponse(error);
}
