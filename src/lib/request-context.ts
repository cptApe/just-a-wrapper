// Open context inside each route; proxy context does not propagate to handlers.
// Background work reopens the captured context with withRequestContext.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors';
import { newTraceId } from './trace';

export type RequestContext = {
  request_id: string;
  trace_id: string;
  route: string;
  workspace_id?: string;
  organization_id?: string;
  user_id?: string;
  session_id?: string;
  /** Owning task for task-run work (create/lifecycle/adoption). */
  task_id?: string;
  feature?: string;
  op?: string;
  artifactId?: string;
  dryRun?: boolean;
  hasSecret?: boolean;
  hasHeader?: boolean;
  webhookSource?: string;
};

const als = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(
  seed: Partial<RequestContext> & { route: string },
  fn: () => T,
): T {
  const ctx: RequestContext = {
    ...seed,
    request_id: seed.request_id ?? randomUUID(),
    // W3C 32-hex trace-id (NOT randomUUID) so the OTLP log export and any
    // downstream OTel collector recognize it. Seed from the inbound
    // `traceparent` via parseTraceparent() at the boundary when present.
    trace_id: seed.trace_id ?? newTraceId(),
  };
  return als.run(ctx, fn);
}

export function ctx(): RequestContext | undefined {
  return als.getStore();
}

export function requireCtx(): RequestContext {
  const store = als.getStore();
  if (!store) {
    throw new AppError('UNEXPECTED', 'no request context — wrap handler in withRequestContext()');
  }
  return store;
}

export function extend(patch: Partial<RequestContext>): void {
  // Throws when there is no active store, because a silent no-op loses the patch.
  Object.assign(requireCtx(), patch);
}

// Snapshot the current context for use inside a `waitUntil` callback. The
// returned object is a plain copy — safe to pass across the async
// boundary that loses the ALS scope.
export function snapshotCtx(): RequestContext {
  return { ...requireCtx() };
}
