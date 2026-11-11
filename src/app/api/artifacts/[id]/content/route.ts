import { headers } from 'next/headers';
import { z } from 'zod';
import { loadOwnedArtifact, openArtifactContent } from '@/features/files/server';
import { resolveCaller } from '@/lib/caller';
import { extend } from '@/lib/request-context';
import { parseRouteParams, withApiRoute } from '@/lib/route-kit';

// GET /api/artifacts/[id]/content — the authed artifact byte proxy. The browser
// never talks to Anthropic: this streams from the Files API with our key after
// the workspace ownership gate (same 404-on-foreign-id contract as sessions).
// `?download=1` flips Content-Disposition to attachment for the Download action.

export const runtime = 'nodejs';
// Streaming bytes must never be statically cached.
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  { route: 'api/artifacts/[id]/content' },
  async (request, context) => {
    const { id: artifactId } = await parseRouteParams(
      context.params,
      z.object({ id: z.string().min(1) }),
    );

    extend({ artifactId });
    const { workspaceId, userId } = await resolveCaller(await headers());
    const artifact = await loadOwnedArtifact({ artifactId, workspaceId, viewerId: userId });
    const download = new URL(request.url).searchParams.get('download') === '1';
    return await openArtifactContent({
      artifact,
      disposition: download ? 'attachment' : 'inline',
      range: request.headers.get('range'),
    });
  },
);
