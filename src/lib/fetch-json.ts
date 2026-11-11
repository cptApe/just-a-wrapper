// Streaming, blob, upload-progress and raw-status callers keep their own fetch.
import { z } from 'zod';
import { AppError } from './errors';

type ServerErrorFields = {
  serverCode?: string;
  serverMessage?: string;
  serverToolUseId?: string;
  serverExpectedState?: boolean;
  serverReason?: string;
};

const serverErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string().optional().catch(undefined),
    toolUseId: z.string().optional().catch(undefined),
    expectedState: z.boolean().optional().catch(undefined),
    reason: z.string().optional().catch(undefined),
  }),
});

function extractServerError(body: unknown): ServerErrorFields {
  const parsed = serverErrorSchema.safeParse(body);
  if (!parsed.success) return {};
  const { code, message, toolUseId, expectedState, reason } = parsed.data.error;
  return {
    serverCode: code,
    serverMessage: message,
    serverToolUseId: toolUseId,
    serverExpectedState: expectedState,
    serverReason: reason,
  };
}

// Perform the request and enforce the 2xx contract, shared by both helpers:
// throws the same AppError on a network reject and on any non-2xx status
// (surfacing the server's `{ error: { code, message } }` when present). Returns
// the successful Response for the caller to consume (or ignore).
async function requestOk(input: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET';

  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (cause) {
    // No response at all — network failure or an aborted request.
    throw new AppError(
      'API_REQUEST_FAILED',
      `${method} ${input} failed (network error)`,
      { url: input, status: undefined },
      { cause },
    );
  }

  if (!res.ok) {
    const message = `${method} ${input} failed (${res.status})`;
    const context: Record<string, unknown> = { status: res.status, url: input };
    try {
      const { serverCode, serverMessage, serverToolUseId, serverExpectedState, serverReason } =
        extractServerError(await res.json());
      throw new AppError('API_REQUEST_FAILED', message, {
        ...context,
        serverCode,
        serverMessage,
        serverToolUseId,
        expectedState: serverExpectedState,
        serverReason,
      });
    } catch (thrownOrParseError) {
      // The rich AppError above is what we mean to surface; rethrow it. Anything
      // else here is `res.json()` rejecting on a non-JSON / empty error body —
      // throw the same failure with just the status/url we already have.
      if (thrownOrParseError instanceof AppError) throw thrownOrParseError;
      throw new AppError('API_REQUEST_FAILED', message, context);
    }
  }

  return res;
}

export async function fetchJson(input: string, init?: RequestInit): Promise<unknown> {
  const res = await requestOk(input, init);
  const method = init?.method ?? 'GET';

  const text = await res.text();
  // A 2xx with no body (an empty/whitespace-only 200, or a 204/205) breaks the
  // Promise<T> contract — callers destructure the result. Fail loudly here
  // rather than hand back an undefined that TypeErrors at the call site; a
  // mutation that legitimately returns nothing must use `fetchVoid`.
  if (text.trim() === '') {
    throw new AppError(
      'API_REQUEST_FAILED',
      `${method} ${input} returned no body where JSON was expected`,
      { status: res.status, url: input },
    );
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch (cause) {
    throw new AppError(
      'API_REQUEST_FAILED',
      `${method} ${input} returned invalid JSON`,
      { url: input, status: res.status },
      { cause },
    );
  }
}

// For mutations whose response body is meaningless to the caller (DELETE, a POST
// that returns nothing). Same non-2xx/network error behavior as fetchJson; the
// success body — empty or not — is discarded and the call resolves void.
export async function fetchVoid(input: string, init?: RequestInit): Promise<void> {
  await requestOk(input, init);
}

// The plain-text twin of `fetchJson`: any request → the raw response body as a
// string, and the same AppError-on-every-failure-path contract (non-2xx,
// network reject). Used by the preview readers that fetch NON-JSON bodies — a
// drive file's text through the authorized file route, an artifact's text through our byte
// proxy — so those reads still satisfy the "every throw is an AppError" rule
// without pretending the body is JSON. Binary/blob downloads (PDF bytes) still
// keep their own `fetch`: this returns a string, not an ArrayBuffer.
export async function fetchText(input: string, init?: RequestInit): Promise<string> {
  const method = init?.method ?? 'GET';

  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (cause) {
    throw new AppError(
      'API_REQUEST_FAILED',
      `${method} ${input} failed (network error)`,
      { url: input, status: undefined },
      { cause },
    );
  }

  if (!res.ok) {
    // Text endpoints (CDN, byte proxy) don't return our structured error shape,
    // so surface just the status/url — same failure the raw callers reported.
    throw new AppError('API_REQUEST_FAILED', `${method} ${input} failed (${res.status})`, {
      status: res.status,
      url: input,
    });
  }

  return res.text();
}
