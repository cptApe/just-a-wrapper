import { headers } from 'next/headers';
import { z } from 'zod';
import { confirmToolUses } from '@/features/session-runtime';
import { authorizeSessionWrite, sessionRouteErrorResponse } from '@/features/sessions';
import { parseJsonBody, parseRouteParams, withApiRoute } from '@/lib/route-kit';

// POST /api/sessions/[id]/tool-confirmations — answer Anthropic-side ask-gates
// (built-in/MCP `evaluated_permission: 'ask'`) with allow/deny. The chat gate UI
// counterpart of /api/custom-tools/confirm: parse → authorize → feature api.

export const runtime = 'nodejs';

const Decision = z.discriminatedUnion('result', [
  z.object({
    toolUseId: z.string().min(1),
    result: z.literal('deny'),
    threadId: z.string().min(1).optional(),
  }),
  z.object({
    toolUseId: z.string().min(1),
    result: z.literal('allow'),
    scope: z.enum(['once', 'session', 'always']),
    threadId: z.string().min(1).optional(),
  }),
]);
const Body = z.object({ decisions: z.array(Decision).min(1) });

export const POST = withApiRoute(
  { route: 'api/sessions/[id]/tool-confirmations', errorResponse: sessionRouteErrorResponse },
  async (request, routeContext) => {
    const { id: sessionId } = await parseRouteParams(
      routeContext.params,
      z.object({ id: z.string() }),
    );
    const body = await parseJsonBody(request, Body);
    const grant = await authorizeSessionWrite({ sessionId, headers: await headers() });
    const outcomes = await confirmToolUses({ grant, decisions: body.decisions });
    return Response.json({ outcomes });
  },
);
