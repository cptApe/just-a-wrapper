// Server error capture attaches request context to PostHog events and keeps a
// structured console fallback. trace_id joins related logs and errors.
// Reporting catches use captureException; see docs/spec/04-observability.md.

import { PostHog } from 'posthog-node';
import { env } from './env';
import { exceptionFromRecord, serializeError } from './errors';
import { lazyValue } from './lazy-value';
import { buildEventProperties } from './observability-properties';
import { flushLogs } from './otel-logs';
import { ctx } from './request-context';
import { sanitize, sanitizeString } from './sanitize';

export const initPostHog = lazyValue((): PostHog | null =>
  env.POSTHOG_PROJECT_KEY ? new PostHog(env.POSTHOG_PROJECT_KEY, { host: env.POSTHOG_HOST }) : null,
);

export function captureException(error: unknown, context: Record<string, unknown> = {}): void {
  const c = ctx();
  const properties = sanitize(buildEventProperties(c, context));
  const serialized = serializeError(error);
  const ph = initPostHog();

  if (ph) {
    // distinctId = user_id when known, so issues group by user where possible.
    ph.captureException(
      exceptionFromRecord(serialized),
      c?.user_id ? sanitizeString(c.user_id) : undefined,
      properties,
    );
  }

  // Console stays as the dev sink and the keyless fallback. In production with a
  // client wired, skip it — PostHog is the surface — to avoid double noise.
  if (!ph || process.env.NODE_ENV !== 'production') {
    console.error('[captureException]', { ...properties, error: serialized });
  }
}

// Register process-level handlers so anything escaping our boundary catches
// still flags an event. Kept here (not in instrumentation.ts) because this
// module is dynamically imported only inside the nodejs branch — referencing
// process.on at the top of instrumentation.ts trips the Edge bundler.
export function registerGlobalErrorHandlers(): void {
  process.on('uncaughtException', (e) => captureException(e, { fatal: 'uncaughtException' }));
  process.on('unhandledRejection', (e) => captureException(e, { fatal: 'unhandledRejection' }));
}

// Flush buffered errors + logs. Serverless functions freeze the moment the
// response is sent, before the batch timers fire — call this inside Next's
// after(): `after(() => flushObservability())`.
export async function flushObservability(): Promise<void> {
  await Promise.allSettled([initPostHog()?.flush(), flushLogs()]);
}
