import { headers } from 'next/headers';
import { z } from 'zod';
import { authorizeSessionWrite, sessionRouteErrorResponse } from '@/features/sessions';
import { confirmPendingTools } from '@/features/tools/server';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';

// POST /api/custom-tools/confirm — resolve persisted destructive confirmations.
// Lands on a DIFFERENT invocation from the dispatch that enqueued them;
// it owns the upstream post. Idempotent on tool_use_id (atomic claim in confirm.ts).

export const runtime = 'nodejs';
export const maxDuration = 300;

const Body = z.object({
  sessionId: z.string().min(1),
  decisions: z
    .array(
      z.object({
        toolUseId: z.string().min(1),
        decision: z.enum(['allow', 'deny']),
        // Tool-specific validation belongs to confirm.ts, where the answer can
        // be checked against the persisted canonical tool input.
      }),
    )
    .min(1),
});

export const POST = withApiRoute(
  {
    route: 'api/custom-tools/confirm',
    feature: 'tooling',
    errorResponse: sessionRouteErrorResponse,
  },
  async (request) => {
    const input = await parseJsonBody(request, Body);
    // Decisions run the creator's tools, so only the creator's write grant may make them.
    const grant = await authorizeSessionWrite({
      sessionId: input.sessionId,
      headers: await headers(),
    });
    const outcomes = await confirmPendingTools({ grant, decisions: input.decisions });
    return Response.json({ outcomes });
  },
);
