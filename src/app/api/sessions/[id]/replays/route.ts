import { headers } from 'next/headers';
import { z } from 'zod';
import { authorizeSessionAccess, sessionRouteErrorResponse } from '@/features/sessions';
import { assertBrowseSessionRecorded, loadReplayMetadata } from '@/features/tools/server';
import { parseRouteParams, parseSearchParams, withApiRoute } from '@/lib/route-kit';

// Authorize the task, then bind the Browserbase ID to its recorded browse result so members cannot
// replay another session. Proxy metadata to keep the API key server-side.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string() });

// The Browserbase session to replay.
const Query = z.object({ bb: z.string().min(1) });

export const GET = withApiRoute(
  {
    route: 'api/sessions/[id]/replays',
    feature: 'tools',
    errorResponse: sessionRouteErrorResponse,
  },
  async (request, { params }) => {
    const { id } = await parseRouteParams(params, paramsSchema);
    const { bb: browserbaseSessionId } = parseSearchParams(request, Query);
    const { anthropicSessionId } = await authorizeSessionAccess({
      sessionId: id,
      headers: await headers(),
    });
    await assertBrowseSessionRecorded({ anthropicSessionId, browserbaseSessionId });
    const metadata = await loadReplayMetadata({ browserbaseSessionId });
    return Response.json(
      { pages: metadata.pages },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  },
);
