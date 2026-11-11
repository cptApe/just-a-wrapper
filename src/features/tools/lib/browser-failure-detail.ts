import { AppError } from '@/lib/errors';

// Diagnosable-from-the-chat failure detail for the browser tools. Two rules:
//
//   1. Bounded and sanitized. The detail rides inside the tool result the
//      agent reads and the card the user sees, so it can never carry the
//      Browserbase API key, a session signing key, a connect URL, or a
//      live-view token. Every string passes through sanitizeBrowserDetail.
//   2. The whole cause chain, not just the top message. Browser outages
//      are diagnosable only from the innermost error (an UnsupportedModelError
//      thrown by the Stagehand constructor, a zod issue on a timestamp), which
//      the generic "Could not open the browser page" wrapper drops.

const MAX_BROWSER_FAILURE_DETAIL_CHARS = 480;
/** The AppError context key that opts a sanitized diagnosis into the chat
 * (tool-error-content.ts). Deliberately not `detail`: that name is too easy to
 * reuse for a raw upstream body somewhere else. */
export const CHAT_DETAIL_KEY = 'chatDetail';
const MAX_CAUSE_DEPTH = 6;
const CHAIN_SEPARATOR = ' ← ';

// Secret-shaped substrings that must never leave the server. Order matters
// only for readability; every pattern is applied.
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  // Browserbase session credentials (create/get bodies, connect URLs).
  /signingKey=[^&\s"']+/gi,
  /wss?:\/\/[^\s"')]+/gi,
  /wss=[^&\s"']+/gi,
  // The live-view token on debugger URLs (`?t=` / `&t=`).
  /([?&]t=)[^&\s"']+/g,
  // API keys by shape: Browserbase, Anthropic, bearer tokens, our own header.
  /\bbb_(?:live|test)_[A-Za-z0-9_-]+/g,
  /\bsk-ant-[A-Za-z0-9_-]+/g,
  /\bBearer\s+[A-Za-z0-9._-]+/g,
  /x-bb-api-key\s*[:=]\s*\S+/gi,
  // Any token-shaped query parameter, so a renamed live-view token still
  // never crosses.
  /([?&](?:token|auth|key|apikey|api_key|signature|sig)=)[^&\s"']+/gi,
];

/** Replace every secret-shaped substring; no bounding, no reflow (the probes
 * print whole JSON bodies through this). */
export function redactSecrets(text: string): string {
  let clean = text;
  for (const pattern of SECRET_PATTERNS) {
    clean = clean.replace(pattern, (match, prefix: unknown) =>
      typeof prefix === 'string' && match.startsWith(prefix) ? `${prefix}[redacted]` : '[redacted]',
    );
  }
  return clean;
}

export function sanitizeBrowserDetail(text: string): string {
  let clean = redactSecrets(text.replace(/\s+/g, ' ').trim());
  if (clean.length > MAX_BROWSER_FAILURE_DETAIL_CHARS) {
    clean = `${clean.slice(0, MAX_BROWSER_FAILURE_DETAIL_CHARS - 1)}…`;
  }
  return clean;
}

function describeOne(error: unknown): string | null {
  if (error instanceof AppError) {
    const detail = error.context[CHAT_DETAIL_KEY];
    if (typeof detail === 'string' && detail.trim()) return detail;
    return error.message;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (!message) return error.name;
    return error.name && error.name !== 'Error' ? `${error.name}: ${message}` : message;
  }
  if (typeof error === 'string') return error;
  if (error === undefined || error === null) return null;
  return String(error);
}

/** The sanitized cause chain of a browser failure, outermost first. */
export function browserFailureDetail(cause: unknown): string {
  const parts: string[] = [];
  let current: unknown = cause;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined; depth += 1) {
    const described = describeOne(current);
    if (described && parts[parts.length - 1] !== described) parts.push(described);
    current = current instanceof Error ? current.cause : undefined;
  }
  return sanitizeBrowserDetail(parts.join(CHAIN_SEPARATOR));
}

export type UpstreamFailure = {
  status: number;
  method: string;
  path: string;
  /** The `message` of Browserbase's `{ statusCode, error, message }` envelope,
   * or the trimmed raw body when the envelope is absent. */
  message?: string;
};

// Plain words for the statuses Browserbase documents or returns live: 400
// "Invalid Session ID", 404 "Not Found", 410 "Session stopped" on /debug of an
// ended session, 429 on the concurrency / creation-rate limit
// (docs.browserbase.com/guides/concurrency-rate-limits). The vendor is named
// only in the detail; the message stays vendor-neutral like every other
// browser-tool message, and no plan numbers are hardcoded (they differ per
// plan).
function statusMeaning(status: number): string {
  if (status === 401 || status === 403) {
    return 'Browserbase rejected the API key, or the plan does not allow this';
  }
  if (status === 402) return "Browserbase says the plan's browser time is used up";
  if (status === 404) return 'Browserbase has no such session';
  if (status === 410) return 'Browserbase already stopped this session';
  if (status === 429) {
    return "Browserbase is at the plan's limit for concurrent browsers or new sessions per minute; wait a minute and retry";
  }
  if (status >= 500) return 'Browserbase had a server error';
  return 'Browserbase refused the request';
}

/** The user-facing message for an upstream status: vendor-neutral. */
export function upstreamFailureMessage(status: number): string {
  if (status === 401 || status === 403)
    return "The browser service rejected this deployment's access";
  if (status === 402) return "The browser service's plan limit was reached";
  if (status === 404) return 'The browser service has no such session';
  if (status === 410) return 'The browser service already stopped this session';
  if (status === 429) {
    return 'The browser service is at its limit for concurrent browsers right now; try again in a minute';
  }
  if (status >= 500) return 'The browser service had a server error';
  return 'The browser service refused the request';
}

/** One line that says what Browserbase did, in plain words, with the HTTP
 * evidence attached. */
export function describeUpstreamFailure(failure: UpstreamFailure): string {
  const evidence = `HTTP ${failure.status} ${failure.method} ${failure.path}${
    failure.message ? `: ${failure.message}` : ''
  }`;
  return sanitizeBrowserDetail(`${statusMeaning(failure.status)} (${evidence})`);
}
