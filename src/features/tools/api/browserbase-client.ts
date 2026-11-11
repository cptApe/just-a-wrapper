import 'server-only';
import { z } from 'zod';
import { IntegrationError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import {
  browserFailureDetail,
  CHAT_DETAIL_KEY,
  describeUpstreamFailure,
  sanitizeBrowserDetail,
  upstreamFailureMessage,
} from '../lib/browser-failure-detail';

// The Browserbase v1 REST surface the browser tools depend on. Every schema
// here is pinned against a VERBATIM live body in
// tests/tools/browserbase-client.test.mjs, never against the docs
// alone: the docs mark `endedAt` required on create yet the live create body
// omits it, and they say nothing about the numeric UTC offset the timestamps
// carry. Fields the app never reads are not parsed at all, so an added or
// renamed upstream field cannot take the feature down.
//
// Every failure throws an IntegrationError whose `context.chatDetail` is a
// bounded, sanitized, plain-words line (the dispatcher posts it to the chat)
// while the message itself stays vendor-neutral.

const BROWSERBASE_API_BASE = 'https://api.browserbase.com/v1';
const MAX_UPSTREAM_BODY_CHARS = 300;
const MAX_SCHEMA_ISSUES = 4;

const contextResponse = z.object({ id: z.string().min(1) });

// Browserbase timestamps carry a numeric UTC offset ("+00:00" rather than "Z")
// and microsecond precision; zod's datetime() rejects the offset unless it is
// opted in, and then every session GET fails as "invalid session".
const browserbaseTimestamp = z.string().datetime({ offset: true });

const BROWSERBASE_SESSION_STATUSES = [
  'PENDING',
  'RUNNING',
  'ERROR',
  'TIMED_OUT',
  'COMPLETED',
] as const;

const sessionResponse = z.object({
  id: z.string().min(1),
  status: z.enum(BROWSERBASE_SESSION_STATUSES),
  startedAt: browserbaseTimestamp,
  // Absent while the session runs; only the clamp fallback reads expiresAt,
  // so a missing or null value degrades to "now" instead of a parse failure.
  endedAt: browserbaseTimestamp.nullish(),
  expiresAt: browserbaseTimestamp.nullish(),
});

// The create body echoes the whole session; only the id and the CDP address are read.
const createdSessionResponse = z.object({ id: z.string().min(1), connectUrl: z.string().min(1) });

const debugResponse = z.object({ debuggerFullscreenUrl: z.string().url() });

// Browserbase's error envelope, e.g. { statusCode: 404, error: "Not Found",
// message: "Not Found" } or { statusCode: 410, error: "Gone", message:
// "Session stopped" }. Every field is optional: a proxy or gateway error body
// may not be this shape at all.
const errorEnvelope = z.object({ message: z.string().optional() }).loose();

export type BrowserbaseRemoteSession = z.infer<typeof sessionResponse>;

/** A session the app can still connect to and drive. */
export function isBrowserbaseSessionLive(session: BrowserbaseRemoteSession): boolean {
  return session.status === 'RUNNING' || session.status === 'PENDING';
}

/** Browserbase answered 404: the session id is unknown (never existed, or
 * purged past the plan's data retention). */
export function isBrowserbaseSessionMissing(error: unknown): boolean {
  return error instanceof IntegrationError && error.context.status === 404;
}

/** Browserbase answered 410 "Session stopped": the resource exists but the
 * session already ended (the live-view URLs of an ended session). */
export function isBrowserbaseSessionGone(error: unknown): boolean {
  return error instanceof IntegrationError && error.context.status === 410;
}

type BrowserbaseRequest = {
  apiKey: string;
  path: string;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
};

type BrowserbaseResponse = { status: number; json: unknown };

function upstreamMessage(bodyText: string, path: string): string | undefined {
  const trimmed = bodyText.trim();
  if (!trimmed) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (cause) {
    // A gateway or proxy answered with something other than Browserbase's
    // envelope; the raw text is still the best evidence we have.
    captureException(cause, { feature: 'tooling', op: 'browserbase-error-body', path });
    return trimmed.slice(0, MAX_UPSTREAM_BODY_CHARS);
  }
  const parsed = errorEnvelope.safeParse(json);
  if (parsed.success && parsed.data.message) return parsed.data.message;
  return trimmed.slice(0, MAX_UPSTREAM_BODY_CHARS);
}

async function browserbaseRequest(input: BrowserbaseRequest): Promise<BrowserbaseResponse> {
  const method = input.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(`${BROWSERBASE_API_BASE}${input.path}`, {
      method,
      ...(method === 'DELETE' ? { signal: AbortSignal.timeout(10_000) } : {}),
      headers: {
        'X-BB-API-Key': input.apiKey,
        ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'The browser service did not respond',
      {
        path: input.path,
        method,
        [CHAT_DETAIL_KEY]: sanitizeBrowserDetail(
          `${method} ${input.path}: ${browserFailureDetail(cause)}`,
        ),
      },
      { cause },
    );
  }

  if (method === 'DELETE' && response.status === 404) return { status: 404, json: null };
  if (!response.ok) {
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch (cause) {
      throw new IntegrationError(
        'EXTERNAL_API_FAILED',
        upstreamFailureMessage(response.status),
        {
          path: input.path,
          method,
          status: response.status,
          [CHAT_DETAIL_KEY]: describeUpstreamFailure({
            status: response.status,
            method,
            path: input.path,
          }),
        },
        { cause },
      );
    }
    // Retry-After may also be an HTTP-date (RFC 7231); only a finite number of
    // seconds is worth keeping.
    const retryAfterSeconds = Number(response.headers.get('retry-after'));
    throw new IntegrationError('EXTERNAL_API_FAILED', upstreamFailureMessage(response.status), {
      path: input.path,
      method,
      status: response.status,
      ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
      [CHAT_DETAIL_KEY]: describeUpstreamFailure({
        status: response.status,
        method,
        path: input.path,
        message: upstreamMessage(bodyText, input.path),
      }),
    });
  }

  if (response.status === 204) return { status: response.status, json: null };

  try {
    return { status: response.status, json: await response.json() };
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'The browser service returned an invalid response',
      {
        path: input.path,
        method,
        status: response.status,
        [CHAT_DETAIL_KEY]: `HTTP ${response.status} ${method} ${input.path}: the body is not JSON`,
      },
      { cause },
    );
  }
}

function schemaIssueDetail(input: {
  status: number;
  method: string;
  path: string;
  error: z.ZodError;
}): string {
  const issues = input.error.issues
    .slice(0, MAX_SCHEMA_ISSUES)
    .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
    .join('; ');
  return sanitizeBrowserDetail(
    `HTTP ${input.status} ${input.method} ${input.path}: the body does not match the expected shape (${issues})`,
  );
}

function parseOrThrow<T>(input: {
  schema: z.ZodType<T>;
  response: BrowserbaseResponse;
  method: string;
  path: string;
  message: string;
  context?: Record<string, unknown>;
}): T {
  const parsed = input.schema.safeParse(input.response.json);
  if (parsed.success) return parsed.data;
  throw new IntegrationError(
    'EXTERNAL_API_FAILED',
    input.message,
    {
      ...input.context,
      path: input.path,
      method: input.method,
      status: input.response.status,
      issues: parsed.error.flatten(),
      [CHAT_DETAIL_KEY]: schemaIssueDetail({
        status: input.response.status,
        method: input.method,
        path: input.path,
        error: parsed.error,
      }),
    },
    { cause: parsed.error },
  );
}

export async function createBrowserbaseContext(input: {
  apiKey: string;
  projectId: string;
}): Promise<string> {
  const path = '/contexts';
  const response = await browserbaseRequest({
    apiKey: input.apiKey,
    path,
    method: 'POST',
    body: { projectId: input.projectId },
  });
  return parseOrThrow({
    schema: contextResponse,
    response,
    method: 'POST',
    path,
    message: 'The browser service returned an invalid context',
  }).id;
}

export async function deleteBrowserbaseContext(apiKey: string, contextId: string): Promise<void> {
  try {
    await browserbaseRequest({
      apiKey,
      path: `/contexts/${encodeURIComponent(contextId)}`,
      method: 'DELETE',
    });
  } catch (cause) {
    if (cause instanceof IntegrationError && cause.context.status === 404) return;
    throw cause;
  }
}

export async function getBrowserbaseSession(
  apiKey: string,
  sessionId: string,
): Promise<BrowserbaseRemoteSession> {
  const path = `/sessions/${encodeURIComponent(sessionId)}`;
  const response = await browserbaseRequest({ apiKey, path });
  return parseOrThrow({
    schema: sessionResponse,
    response,
    method: 'GET',
    path,
    message: 'The browser service returned an invalid session',
    context: { sessionId },
  });
}

export async function getBrowserbaseDebugUrl(apiKey: string, sessionId: string): Promise<string> {
  const path = `/sessions/${encodeURIComponent(sessionId)}/debug`;
  const response = await browserbaseRequest({ apiKey, path });
  return parseOrThrow({
    schema: debugResponse,
    response,
    method: 'GET',
    path,
    message: 'The browser live view is unavailable',
    context: { sessionId },
  }).debuggerFullscreenUrl;
}

/** Ask Browserbase to end a session now and return its echoed record (the
 * response is the full Session, with `endedAt` once stopped). Idempotent
 * upstream: releasing an already COMPLETED session answers 200 unchanged. */
export async function releaseBrowserbaseSession(
  apiKey: string,
  projectId: string,
  sessionId: string,
): Promise<BrowserbaseRemoteSession> {
  const path = `/sessions/${encodeURIComponent(sessionId)}`;
  const response = await browserbaseRequest({
    apiKey,
    path,
    method: 'POST',
    body: { status: 'REQUEST_RELEASE', projectId },
  });
  return parseOrThrow({
    schema: sessionResponse,
    response,
    method: 'POST',
    path,
    message: 'The browser service returned an invalid session',
    context: { sessionId },
  });
}

/** Metadata Browserbase stores on a session and can search by (string values only). */
export type BrowserbaseSessionTag = Record<string, string>;

/** Create a one-shot session for a direct CDP connection. */
export async function createBrowserbaseSession(input: {
  apiKey: string;
  projectId: string;
  timeoutSeconds: number;
  tag: BrowserbaseSessionTag;
}): Promise<{ id: string; connectUrl: string }> {
  const path = '/sessions';
  const response = await browserbaseRequest({
    apiKey: input.apiKey,
    path,
    method: 'POST',
    body: {
      projectId: input.projectId,
      timeout: input.timeoutSeconds,
      keepAlive: false,
      userMetadata: input.tag,
    },
  });
  return parseOrThrow({
    schema: createdSessionResponse,
    response,
    method: 'POST',
    path,
    message: 'The browser service returned an invalid session',
  });
}

/** Every session whose metadata field equals the value, whatever its status. */
export async function listBrowserbaseSessionsByTag(
  apiKey: string,
  tag: { key: string; value: string },
): Promise<BrowserbaseRemoteSession[]> {
  const query = `user_metadata['${tag.key}']:'${tag.value}'`;
  const path = `/sessions?q=${encodeURIComponent(query)}`;
  const response = await browserbaseRequest({ apiKey, path });
  return parseOrThrow({
    schema: z.array(sessionResponse),
    response,
    method: 'GET',
    path: '/sessions',
    message: 'The browser service returned an invalid session list',
  });
}
