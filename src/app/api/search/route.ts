import { headers } from 'next/headers';
import { z } from 'zod';
import { searchMemory, searchWorkspace } from '@/features/search/server';
import { resolveCaller } from '@/lib/caller';
import { parseSearchParams, withApiRoute } from '@/lib/route-kit';

// GET /api/search?q=<query> — the command menu's one backend. `group=memory` is the Memory
// pane's search over every note. Parse → resolve the caller's workspace (never trust a
// client-sent id) → call the search feature → return typed grouped results.
// UNAUTHENTICATED → 401, WORKSPACE_NOT_FOUND → 404, a bad query → 400, else 500.

export const runtime = 'nodejs';

const Query = z.object({ q: z.string().min(1).max(200), group: z.literal('memory').optional() });

export const GET = withApiRoute({ route: 'api/search' }, async (request) => {
  const { workspaceId, userId } = await resolveCaller(await headers());
  const { q: query, group } = parseSearchParams(request, Query);
  if (group === 'memory')
    return Response.json({ results: await searchMemory({ headers: await headers(), query }) });

  const results = await searchWorkspace({
    workspaceId,
    userId,
    query,
    headers: await headers(),
  });
  return Response.json({ results });
});
