// Server-side product-event capture — the one funnel raw posthog-node capture is
// allowed through (ESLint blocks `posthog.capture(` elsewhere). Mirrors the
// captureException split in observability.ts: same singleton, same ALS-context
// envelope, keyless-safe, fire-and-forget.
//
// distinctId = user_id from ALS context so server events land on the same person
// as the client's `posthog.identify(userId)` (identity stitching).
// Properties are the full request envelope (environment / request_id / trace_id
// / workspace_id / organization_id / user_id / session_id / feature / route)
// plus the per-call tags — so every event is joinable without archaeology.
//
// Delivery rides the boundary flush: withApiRoute's `after` for routes,
// the relay's settled background work for stream-side captures, the explicit
// flush the webhooks do. Nothing here flushes on its own.
//
// See docs/spec/10-analytics-events.md §2, §4, §7.

import type { AnalyticsEventName } from './analytics-events';
import { logger } from './logger';
import { captureException, initPostHog } from './observability';
import { buildEventProperties } from './observability-properties';
import { ctx } from './request-context';

export { type DeploymentEnvironment, deploymentEnvironment } from './observability-properties';

// `identity` is for call sites that run outside a user-bearing request context
// (Better Auth hooks, Stripe webhooks): they know the user and workspace from
// their own payload, so they pass them explicitly instead of relying on ALS.
export type CaptureIdentity = { userId?: string | null; workspaceId?: string | null };

// Fire-and-forget: NEVER throws into the caller. Any failure is swallowed and
// reported through captureException (the one allowed catch shape here) —
// analytics must never break a business code path. Skips silently (a debug line
// only) when there is no user to attribute the event to, and no-ops entirely
// when PostHog is keyless.
export function captureEvent(
  name: AnalyticsEventName,
  props?: Record<string, unknown>,
  identity: CaptureIdentity = {},
): void {
  try {
    const c = ctx();
    const userId = identity.userId ?? c?.user_id;
    if (!userId) {
      // No authenticated user to attribute this to. Anonymous server events are
      // not stitchable to a person, so we skip rather than send an orphan.
      logger().debug({ event: name }, 'analytics: skipping capture, no user_id in context');
      return;
    }

    const ph = initPostHog();
    if (!ph) return; // keyless: no-op, no throw, no noise

    // The workspace rides along as a PostHog group so per-workspace views work
    // once group analytics is enabled; until then it is an inert $groups prop.
    const workspaceId = identity.workspaceId ?? c?.workspace_id;
    ph.capture({
      distinctId: userId,
      event: name,
      properties: buildEventProperties(c, {
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
        user_id: userId,
        ...props,
      }),
      ...(workspaceId ? { groups: { workspace: workspaceId } } : {}),
    });
  } catch (err) {
    captureException(err, { analytics_event: name });
  }
}
