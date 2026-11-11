import { headers } from 'next/headers';
import { z } from 'zod';
import { saveArtifactToKnowledge } from '@/features/files/server';
import { resolveCaller } from '@/lib/caller';
import { extend } from '@/lib/request-context';
import { parseRouteParams, withApiRoute } from '@/lib/route-kit';

// POST /api/artifacts/[id]/save: copy the artifact into the caller's Library and
// record it as their save. Re-saving returns the copy already recorded.

export const runtime = 'nodejs';

export const POST = withApiRoute({ route: 'api/artifacts/[id]/save' }, async (request, context) => {
  const { id: artifactId } = await parseRouteParams(
    context.params,
    z.object({ id: z.string().min(1) }),
  );

  extend({ artifactId });
  const { workspaceId, userId } = await resolveCaller(await headers());
  const result = await saveArtifactToKnowledge({ artifactId, workspaceId, userId });
  return Response.json(result);
});
