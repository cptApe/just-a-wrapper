import { headers } from 'next/headers';
import { z } from 'zod';
import {
  listSessionArtifacts,
  listSessionFiles,
  sweepSessionArtifacts,
} from '@/features/files/server';
import { authorizeSessionAccess, sessionRouteErrorResponse } from '@/features/sessions';
import { parseRouteParams, withApiRoute } from '@/lib/route-kit';

// Refresh artifacts after idle or file references so indexed outputs appear promptly. One sweep
// per request keeps provider indexing delays out of the response.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  { route: 'api/sessions/[id]/artifacts', errorResponse: sessionRouteErrorResponse },
  async (request, routeContext) => {
    const { id: sessionId } = await parseRouteParams(
      routeContext.params,
      z.object({ id: z.string() }),
    );
    const { workspaceId, anthropicSessionId, userId } = await authorizeSessionAccess({
      sessionId,
      headers: await headers(),
    });
    if (new URL(request.url).searchParams.get('refresh') === '1') {
      await sweepSessionArtifacts({ anthropicSessionId, profile: 'single' });
    }
    const [artifacts, libraryFiles] = await Promise.all([
      listSessionArtifacts({ anthropicSessionId, workspaceId, viewerId: userId }),
      listSessionFiles({ anthropicSessionId, workspaceId, viewerId: userId }),
    ]);
    return Response.json(
      { artifacts, libraryFiles },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  },
);
