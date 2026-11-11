import { headers } from 'next/headers';
import { z } from 'zod';
import { sessionRouteErrorResponse } from '@/features/sessions';
import { CUSTOM_TOOL_ALREADY_RESOLVED } from '@/features/sessions/server';
import { dispatchRequest } from '@/features/tools/server';
import { AppError } from '@/lib/errors';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';
export const runtime = 'nodejs';
// Custom-tool handlers can be slow because they write to the database and memory store.
export const maxDuration = 300;
const Body = z.object({
  /** Our session.id uuid (the task URL id) — resolved to the Anthropic id server-side. */
  sessionId: z.string().min(1),
  calls: z
    .array(
      z.object({
        toolUseId: z.string().min(1),
        name: z.string().min(1),
      }),
    )
    .min(1),
});

export const POST = withApiRoute(
  {
    route: 'api/custom-tools/dispatch',
    feature: 'tooling',
    errorResponse(error) {
      if (
        error instanceof AppError &&
        error.code === 'TOOL_INPUT_INVALID' &&
        error.context.rejectionCode === CUSTOM_TOOL_ALREADY_RESOLVED
      ) {
        return Response.json(
          {
            error: {
              code: CUSTOM_TOOL_ALREADY_RESOLVED,
              message: 'This tool call already has a result.',
              toolUseId: error.context.toolUseId,
            },
          },
          { status: 400 },
        );
      }
      return sessionRouteErrorResponse(error);
    },
  },
  async (request) => {
    const input = await parseJsonBody(request, Body);
    return Response.json({ outcomes: await dispatchRequest(input, await headers()) });
  },
);
