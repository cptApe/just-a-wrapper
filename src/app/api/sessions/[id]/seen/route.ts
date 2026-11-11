import { headers } from 'next/headers';
import { z } from 'zod';
import { markSessionSeen, sessionRouteErrorResponse } from '@/features/sessions';
import { resolveCaller } from '@/lib/caller';
import { parseRouteParams, withApiRoute } from '@/lib/route-kit';

// Mark seen for the caller without a request body. The active task route
// triggers the shared mark-session-seen path.

export const runtime = 'nodejs';

export const POST = withApiRoute(
  { route: 'api/sessions/[id]/seen', errorResponse: sessionRouteErrorResponse },
  async (_request, routeContext) => {
    const { id } = await parseRouteParams(routeContext.params, z.object({ id: z.string() }));
    const { workspaceId, userId, organizationId } = await resolveCaller(await headers());
    await markSessionSeen({
      sessionId: id,
      workspaceId,
      userId,
      organizationId,
    });
    return Response.json({ ok: true });
  },
);
