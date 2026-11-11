// Client instrumentation (Next 16 file convention) — runs before the app
// becomes interactive. Initializes posthog-js for client error capture +
// analytics, pointed at the EU Cloud region. No-ops without the public key so
// the build and a keyless runtime stay clean.
//
// observability-client.ts routes captured errors here; this is just init.
//
// See docs/spec/04-observability.md §11.3.

import posthog from 'posthog-js';
import { env } from '@/lib/env';
import { browserDeploymentEnvironment } from '@/lib/observability-properties';

if (env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(env.NEXT_PUBLIC_POSTHOG_KEY, {
    // Reverse-proxied through Next rewrites so ad blockers can't drop ingest
    // (the /ingest/* rules live in next.config.ts). ui_host stays the
    // real PostHog origin so toolbar/links resolve.
    api_host: '/ingest',
    ui_host: env.NEXT_PUBLIC_POSTHOG_UI_HOST,
    // Capture unhandled errors/rejections automatically in addition to the
    // explicit captureException calls at our boundaries.
    capture_exceptions: true,
    // Deliberate events only: no autocapture and no automatic pageview, because
    // $pageview fires on router transitions below. The
    // explicit `false` also stops the `defaults` preset double-firing $pageview.
    autocapture: false,
    capture_pageview: false,
    defaults: '2025-05-24',
  });
  // Every browser capture, page views and caught errors included, carries the
  // deploy environment the server events carry. Dashboards and alerts show
  // the environment chosen at their last sync.
  posthog.register({ environment: browserDeploymentEnvironment() });
  // capture_pageview:false also suppresses the INITIAL hard-load pageview,
  // and onRouterTransitionStart only fires on client navigations — so send
  // the landing pageview once here (the view funnels/attribution care most about).
  posthog.capture('$pageview');
}

// Propagate client-side router navigations as PostHog pageviews.
export function onRouterTransitionStart(): void {
  if (env.NEXT_PUBLIC_POSTHOG_KEY) posthog.capture('$pageview');
}
