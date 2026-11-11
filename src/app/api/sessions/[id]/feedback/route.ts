import { headers } from 'next/headers';
import { z } from 'zod';
import { submitMessageFeedback } from '@/features/feedback/server';
import { authorizeSessionWrite, sessionRouteErrorResponse } from '@/features/sessions';
import { parseJsonBody, parseRouteParams, withApiRoute } from '@/lib/route-kit';

// POST /api/sessions/[id]/feedback — thumbs up/down on an assistant message.
// Parse → authorize → feature. The comment cap mirrors the DB CHECK.

export const runtime = 'nodejs';

const Body = z.object({
  eventId: z.string().min(1),
  rating: z.enum(['up', 'down']),
  comment: z.string().trim().max(2000).optional(),
  // Does this post resolve the rating decision? The bare-vote thumb click sends
  // false (persist only); the comment modal's Send/Cancel sends true, which is
  // the single point that feeds the agent. Defaults false for safety.
  final: z.boolean().optional().default(false),
});

export const POST = withApiRoute(
  { route: 'api/sessions/[id]/feedback', errorResponse: sessionRouteErrorResponse },
  async (request, routeContext) => {
    const { id: sessionId } = await parseRouteParams(
      routeContext.params,
      z.object({ id: z.string() }),
    );
    // Feedback is sent into the agent session, which only its creator may steer.
    const grant = await authorizeSessionWrite({ sessionId, headers: await headers() });
    const body = await parseJsonBody(request, Body);
    const { delivered } = await submitMessageFeedback({
      grant,
      eventId: body.eventId,
      rating: body.rating,
      comment: body.comment,
      final: body.final,
    });
    return Response.json({ ok: true, delivered });
  },
);
