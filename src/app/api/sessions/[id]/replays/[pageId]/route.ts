import { headers } from 'next/headers';
import { z } from 'zod';
import { authorizeSessionAccess, sessionRouteErrorResponse } from '@/features/sessions';
import { assertBrowseSessionRecorded, loadReplayManifest } from '@/features/tools/server';
import { parseRouteParams, parseSearchParams, withApiRoute } from '@/lib/route-kit';

// Authorize the task and its recorded Browserbase ID before proxying the manifest. Signed CDN
// segment URLs go directly to the player; only the manifest needs the secret key.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string(), pageId: z.string() });

// The Browserbase session to replay.
const Query = z.object({ bb: z.string().min(1) });

export const GET = withApiRoute(
  {
    route: 'api/sessions/[id]/replays/[pageId]',
    feature: 'tools',
    errorResponse: sessionRouteErrorResponse,
  },
  async (request, { params }) => {
    const { id, pageId } = await parseRouteParams(params, paramsSchema);
    const { bb: browserbaseSessionId } = parseSearchParams(request, Query);
    const { anthropicSessionId } = await authorizeSessionAccess({
      sessionId: id,
      headers: await headers(),
    });
    await assertBrowseSessionRecorded({ anthropicSessionId, browserbaseSessionId });
    const manifest = await loadReplayManifest({ browserbaseSessionId, pageId });
    return new Response(manifest, {
      headers: {
        'content-type': 'application/vnd.apple.mpegurl',
        // The signed segment URLs inside expire ~6h out and are re-minted on each
        // fetch, so the manifest itself must never be cached.
        'cache-control': 'private, no-store',
      },
    });
  },
);
