import { headers } from 'next/headers';
import { z } from 'zod';
import { creatorGateResolver, sessionEventStream } from '@/features/session-runtime';
import { authorizeSessionAccess, sessionRouteErrorResponse } from '@/features/sessions';
import { shipLog } from '@/lib/logger';
import { ctx } from '@/lib/request-context';
import { parseRouteParams, withApiRoute } from '@/lib/route-kit';

// EventSource resumes from Last-Event-ID. Keep authorization and SSE framing at the route boundary
// and stream work inside sessions.
export const runtime = 'nodejs';
// A touch above the relay's internal 280s deadline; the relay closes cleanly
// first and the browser reconnects + resumes.
export const maxDuration = 300;
// SSE must never be statically cached or buffered.
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  { route: 'api/sessions/[id]/stream', errorResponse: sessionRouteErrorResponse },
  async (request, routeContext) => {
    // `id` is OUR session.id uuid; the gate resolves it to the row's
    // Anthropic id, which is what the relay actually attaches to upstream.
    const { id: sessionId } = await parseRouteParams(
      routeContext.params,
      z.object({ id: z.string() }),
    );

    // Log arrival before auth and compare with sessions.relay_attached.
    // No arrival indicates a client transport failure; arrival without attach
    // locates the gap on the server or upstream connection path.
    shipLog({
      msg: 'sessions.relay_request',
      feature: 'sessions',
      op: 'relay',
      session_id: sessionId,
    });

    // Ownership gate BEFORE the relay attaches: assert this session belongs to the
    // caller's active workspace, else 404 (don't leak existence). Enriches the ALS
    // context with workspace_id / user_id / session_id for tenant attribution.
    const grant = await authorizeSessionAccess({ sessionId, headers: await headers() });

    const url = new URL(request.url);
    // Lightweight authenticated probe for a permanently closed EventSource.
    // It reuses this route's access gate without opening an upstream stream or
    // fetching the transcript.
    if (url.searchParams.get('probe') === '1') return new Response(null, { status: 204 });

    // Resume cursor: EventSource sends `Last-Event-ID` automatically; accept a
    // `?last_event_id=` query param too for manual/initial attaches.
    const lastEventId =
      request.headers.get('last-event-id') ?? url.searchParams.get('last_event_id');

    // Gate resolution is bound to the session CREATOR (the connection owner whose
    // tool_permission rows govern the agent's actions), not the streaming caller.
    const stream = sessionEventStream({
      sessionId: grant.anthropicSessionId,
      lastEventId,
      signal: request.signal,
      traceId: ctx()?.trace_id ?? null,
      resolveGate: creatorGateResolver(grant),
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
      },
    });
  },
);
