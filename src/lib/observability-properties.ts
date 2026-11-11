// Pure helper: build the PostHog event properties from ALS context + per-call
// tags. Dependency-free (no env / posthog-node / errors import) so the "context
// is forwarded as event properties" contract is unit-testable
// under strip-only `node --test`, where the env-coupled observability module
// can't load.
//
// See docs/spec/04-observability.md §11.3.

type CtxFields = Record<string, unknown> | undefined;

export type DeploymentEnvironment = 'development' | 'preview' | 'production';

// Which deploy a capture came from. Dashboards and alerts show the environment
// chosen at their last sync. Vercel names the deploy (VERCEL_ENV); elsewhere
// NODE_ENV is the only signal. Read here, not in env.ts, so this module stays
// dependency-free.
export function deploymentEnvironment(): DeploymentEnvironment {
  return environmentFrom(process.env.VERCEL_ENV);
}

// The browser bundle never sees VERCEL_ENV; Vercel exposes the same value as
// NEXT_PUBLIC_VERCEL_ENV. posthog-js registers this once at init so page views
// and caught browser errors carry the same `environment` the server events do.
export function browserDeploymentEnvironment(): DeploymentEnvironment {
  return environmentFrom(process.env.NEXT_PUBLIC_VERCEL_ENV);
}

function environmentFrom(vercel: string | undefined): DeploymentEnvironment {
  if (vercel === 'production' || vercel === 'preview' || vercel === 'development') return vercel;
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

export function buildEventProperties(
  ctxFields: CtxFields,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const c = ctxFields ?? {};
  return {
    environment: deploymentEnvironment(),
    request_id: c.request_id,
    trace_id: c.trace_id,
    workspace_id: c.workspace_id,
    organization_id: c.organization_id,
    session_id: c.session_id,
    user_id: c.user_id,
    feature: c.feature,
    op: c.op,
    route: c.route,
    ...extra,
  };
}
