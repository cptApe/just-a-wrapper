import { headers } from 'next/headers';
import { z } from 'zod';
// Direct module import (not the billing barrel): the barrel drags the Stripe
// graph; this route needs only the resume slice.
import { resumeSessionExplicitly } from '@/features/billing/server';
import { authorizeSessionWrite, sessionRouteErrorResponse } from '@/features/sessions';
import { parseRouteParams, withApiRoute } from '@/lib/route-kit';

// Explicit Resume for sessions outside the auto-resume window.
// Return 402 while workspace credits are empty.

export const runtime = 'nodejs';

export const POST = withApiRoute(
  { route: 'api/sessions/[id]/resume', errorResponse: sessionRouteErrorResponse },
  async (_request, routeContext) => {
    const { id: sessionId } = await parseRouteParams(
      routeContext.params,
      z.object({ id: z.string() }),
    );
    const grant = await authorizeSessionWrite({ sessionId, headers: await headers() });
    const result = await resumeSessionExplicitly(grant);
    return Response.json(result);
  },
);
