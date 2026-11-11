// Server instrumentation (Next 16 file convention). register() runs once per
// server instance before any request is handled; onRequestError catches errors
// escaping the framework (RSC render, route handlers) that never hit one of our
// boundary catches.
//
// Wires: (1) posthog-node error client, (2) the OTel LoggerProvider that exports
// PostHog Logs over OTLP, (3) process-level uncaught/unhandled handlers, (4) the
// route boundary's post-response flush scheduler (Next's `after`). All no-op
// without POSTHOG_PROJECT_KEY so the build passes keyless.
//
// See docs/spec/04-observability.md §11.3, docs/spec/10-analytics-events.md §6.

import type { Instrumentation } from 'next';

export async function register(): Promise<void> {
  // Node-only: the OTLP exporter and posthog-node are node modules, and ALS /
  // process handlers don't exist on the edge runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { initPostHog, registerGlobalErrorHandlers } = await import('@/lib/observability');
  const { initLoggerProvider } = await import('@/lib/otel-logs');

  // 1. Error tracking client (captured via the captureException wrapper).
  initPostHog();

  // 2. Logs — OTel LoggerProvider exporting OTLP-HTTP straight to PostHog Logs.
  await initLoggerProvider();

  // 3. Process-level handlers — anything escaping the boundaries still flags.
  registerGlobalErrorHandlers();
}

// Framework-level server error hook. The error may have been reprocessed by
// React (use `digest` to identify) — we still capture it so RSC/render failures
// aren't invisible.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { captureException, flushObservability } = await import('@/lib/observability');
  const { withRequestContext } = await import('@/lib/request-context');
  await withRequestContext({ route: context.routePath }, async () => {
    try {
      captureException(err, {
        source: 'onRequestError',
        path: request.path,
        method: request.method,
        router: context.routerKind,
        route: context.routePath,
      });
    } finally {
      await flushObservability();
    }
  });
};
