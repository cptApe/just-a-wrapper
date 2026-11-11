// Client-side product-event capture — mirrors lib/analytics.ts with the same
// name and signature so call sites read identically across runtimes, and one of
// the few files ESLint permits raw `posthog.capture(` in. Reserved for the
// pure-intent exceptions: moments that never hit our server, or where
// funnel timing on the page matters. Prefer the server helper wherever a server
// path exists — server events survive ad blockers and dropped tabs.
//
// posthog-js is initialized once in instrumentation-client.ts; this just routes
// through it. Guarded on the public key so a keyless runtime is a clean no-op
// (posthog-js is itself a no-op before init, but the guard keeps intent explicit
// and matches observability-client.ts). Fire-and-forget: never throws into the
// caller — a capture failure is reported, not propagated.
//
// See docs/spec/10-analytics-events.md §2, §4.

import posthog from 'posthog-js';
import type { AnalyticsEventName } from './analytics-events';
import { env } from './env';
import { captureException } from './observability-client';

export function captureEvent(name: AnalyticsEventName, props?: Record<string, unknown>): void {
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return;
  try {
    posthog.capture(name, props);
  } catch (err) {
    captureException(err, { analytics_event: name });
  }
}

// Clear the identified person on sign-out. posthog-js otherwise keeps
// the prior user's distinct_id on this device, so the next person's pre-login
// events (and a shared-computer session) would stitch onto the wrong profile.
// PostHog: "We strongly recommend you call reset on logout even if you don't
// expect users to share a computer." Keyless = clean no-op. Fire-and-forget: a
// reset failure is reported, never propagated into the sign-out flow.
export function resetIdentity(): void {
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return;
  try {
    posthog.reset();
  } catch (err) {
    captureException(err, { op: 'analytics.reset' });
  }
}
