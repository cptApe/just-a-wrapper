// Client-side capture sink mirroring lib/observability.ts — same exported name
// and signature so call sites read identically across runtimes and the
// `no-silent-catch` rule recognizes it. There's no ALS request context in the
// browser; posthog-js attaches its own client context (session/replay/url).
//
// posthog-js is initialized once in instrumentation-client.ts; this just routes
// captured errors to it, with a console line as the dev sink / keyless fallback.
//
// See docs/spec/04-observability.md §4, §11.3.

import posthog from 'posthog-js';
import { env } from './env';
import { exceptionFromRecord, serializeError } from './errors';
import { sanitize } from './sanitize';

// sanitize() reads Safari and Firefox `fn@url` stack frames as email addresses.
// PostHog source-maps those frames, and they hold only code locations once the
// message inside the stack is redacted.
function reportableException(error: unknown, serialized: Record<string, unknown>): Error {
  const exception = exceptionFromRecord(serialized);
  if (error instanceof Error && error.stack) {
    exception.stack = error.stack.replace(error.message, () => exception.message);
  }
  return exception;
}

export function captureException(error: unknown, context: Record<string, unknown> = {}): void {
  const serialized = serializeError(error);
  const safeContext = sanitize(context);

  // posthog-js is a no-op before init; guard on the key so we don't call into an
  // uninitialized singleton when running keyless.
  if (env.NEXT_PUBLIC_POSTHOG_KEY) {
    posthog.captureException(reportableException(error, serialized), safeContext);
  }

  if (!env.NEXT_PUBLIC_POSTHOG_KEY || process.env.NODE_ENV !== 'production') {
    console.error('[captureException]', { ...safeContext, error: serialized });
  }
}
