import { headers } from 'next/headers';
import { z } from 'zod';
import { MAX_MESSAGE_CHARS } from '@/features/chat/server';
import { createInteractiveChat, listWorkspaceSessionsPage } from '@/features/session-runtime';
import { sessionRouteErrorResponse } from '@/features/sessions';
import { dispatchSessionActions } from '@/features/tools/server';
import { assertExpectedOrganization } from '@/lib/assert-expected-organization';
import { resolveCaller } from '@/lib/caller';
import { parseJsonBody, parseSearchParams, withApiRoute } from '@/lib/route-kit';

// Attachment uploads defer the first turn until mounting completes; list responses use an opaque
// cursor for infinite scrolling.
export const runtime = 'nodejs';
export const maxDuration = 120; // session create can take up to ~90s (CREATE_TIMEOUT_MS in create-managed-chat-session.ts)

const Body = z.object({
  expectedOrganizationId: z.string().min(1),
  message: z.string().min(1).max(MAX_MESSAGE_CHARS),
  tier: z.enum(['fast', 'default', 'pro']).default('default'),
  deferMessage: z.boolean().default(false),
});

const ListQuery = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const GET = withApiRoute(
  { route: 'api/sessions#list', errorResponse: sessionRouteErrorResponse },
  async (request) => {
    const { workspaceId, userId } = await resolveCaller(await headers());
    const query = parseSearchParams(request, ListQuery);

    const page = await listWorkspaceSessionsPage({
      workspaceId,
      viewerId: userId,
      cursor: query.cursor ?? null,
      limit: query.limit,
      dispatchPendingToolCalls: dispatchSessionActions,
    });
    return Response.json(page);
  },
);

export const POST = withApiRoute(
  { route: 'api/sessions', errorResponse: sessionRouteErrorResponse },
  async (request) => {
    // The session row is keyed to the caller's active workspace so the stream and send gates can authorize it.
    const { workspaceId, userId, organizationId } = await resolveCaller(await headers());

    const body = await parseJsonBody(request, Body);
    assertExpectedOrganization(organizationId, body.expectedOrganizationId);

    const { sessionId } = await createInteractiveChat({
      workspaceId,
      organizationId,
      userId,
      message: body.message,
      tier: body.tier,
      deferMessage: body.deferMessage,
      dispatchPendingToolCalls: dispatchSessionActions,
    });
    return Response.json({ sessionId });
  },
);
