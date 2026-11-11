import { headers } from 'next/headers';
import { z } from 'zod';
import {
  authorizeSessionAccess,
  listSessionEvents,
  sessionRouteErrorResponse,
} from '@/features/sessions';
import { parseRouteParams, withApiRoute } from '@/lib/route-kit';

// GET /api/sessions/[id]/events — the complete transcript in one response.
// Upstream SDK pagination is exhausted inside listSessionEvents; the browser
// never receives cursors or page-boundary state.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  { route: 'api/sessions/[id]/events', errorResponse: sessionRouteErrorResponse },
  async (_request, routeContext) => {
    const { id: sessionId } = await parseRouteParams(
      routeContext.params,
      z.object({ id: z.string() }),
    );
    const { anthropicSessionId } = await authorizeSessionAccess({
      sessionId,
      headers: await headers(),
    });
    const events = await listSessionEvents(anthropicSessionId);
    return Response.json({ events });
  },
);
