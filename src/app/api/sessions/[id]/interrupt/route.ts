import { headers } from 'next/headers';
import { z } from 'zod';
import {
  authorizeSessionWrite,
  interruptSession,
  sessionRouteErrorResponse,
} from '@/features/sessions';
import { parseRouteParams, withApiRoute } from '@/lib/route-kit';

// POST /api/sessions/[id]/interrupt — stop the agent's current turn (the
// composer's stop button while streaming). Parse → auth → call feature → 204.

export const runtime = 'nodejs';

export const POST = withApiRoute(
  { route: 'api/sessions/[id]/interrupt', errorResponse: sessionRouteErrorResponse },
  async (_request, routeContext) => {
    const { id: sessionId } = await parseRouteParams(
      routeContext.params,
      z.object({ id: z.string() }),
    );

    // Creator gate BEFORE the interrupt posts; a missing or private session is a 404.
    const grant = await authorizeSessionWrite({ sessionId, headers: await headers() });
    await interruptSession(grant);
    return new Response(null, { status: 204 });
  },
);
