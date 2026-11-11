import { headers } from 'next/headers';
import { z } from 'zod';
import { MAX_MESSAGE_CHARS } from '@/features/chat/server';
import { sendSessionMessage } from '@/features/session-runtime';
import { authorizeSessionWrite, sessionRouteErrorResponse } from '@/features/sessions';
import { dispatchSessionActions } from '@/features/tools/server';
import { parseJsonBody, parseRouteParams, withApiRoute } from '@/lib/route-kit';

// Return the upstream event ID to reconcile optimistic messages. A null processedAt means the
// accepted message is queued behind earlier work.
export const runtime = 'nodejs';

const Body = z.object({
  text: z.string().min(1).max(MAX_MESSAGE_CHARS),
  sendId: z.string().uuid().optional(),
  opening: z.boolean().optional(),
});

export const POST = withApiRoute(
  { route: 'api/sessions/[id]/send', errorResponse: sessionRouteErrorResponse },
  async (request, routeContext) => {
    const { id: sessionId } = await parseRouteParams(
      routeContext.params,
      z.object({ id: z.string() }),
    );
    // Creator gate BEFORE the message posts: a missing or private session is a 404 and a shared
    // reader is refused. The grant carries the Anthropic id the send targets. The spend gate runs
    // inside sendSessionMessage and refuses with 402.
    const caller = await authorizeSessionWrite({ sessionId, headers: await headers() });

    const body = await parseJsonBody(request, Body);

    const echo = await sendSessionMessage({
      sessionId,
      text: body.text,
      sendId: body.sendId,
      opening: body.opening,
      caller,
      dispatchPendingToolCalls: dispatchSessionActions,
    });

    return Response.json({
      event: echo ? { id: echo.eventId, processedAt: echo.processedAt } : null,
    });
  },
);
