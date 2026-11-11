import { headers } from 'next/headers';
import { z } from 'zod';
import {
  authorizeSessionIdentityWrite,
  deleteSession,
  sessionRouteErrorResponse,
  updateSessionDetails,
} from '@/features/sessions';
import { parseJsonBody, parseRouteParams, withApiRoute } from '@/lib/route-kit';

// Rename and pin preserve session identity; delete hides the row because billing and audit
// references must survive.
export const runtime = 'nodejs';

const PatchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    favorited: z.boolean().optional(),
  })
  .refine((body) => body.title !== undefined || body.favorited !== undefined, {
    message: 'title or favorited is required',
  });

export const PATCH = withApiRoute(
  { route: 'api/sessions/[id]', errorResponse: sessionRouteErrorResponse },
  async (request, routeContext) => {
    const { id } = await parseRouteParams(routeContext.params, z.object({ id: z.string() }));
    // Only creators may rename or pin shared tasks; a collaborator edit would otherwise surprise the
    // owner through a realtime title update.
    const { workspaceId, organizationId } = await authorizeSessionIdentityWrite({
      sessionId: id,
      headers: await headers(),
    });

    const body = await parseJsonBody(request, PatchBody);

    return Response.json(
      await updateSessionDetails({
        sessionId: id,
        workspaceId,
        organizationId,
        title: body.title,
        favorited: body.favorited,
      }),
    );
  },
);

export const DELETE = withApiRoute(
  { route: 'api/sessions/[id]', errorResponse: sessionRouteErrorResponse },
  async (_request, routeContext) => {
    const { id } = await parseRouteParams(routeContext.params, z.object({ id: z.string() }));
    // soft-delete is a write — creator-only (private-other 404s).
    const { workspaceId, organizationId } = await authorizeSessionIdentityWrite({
      sessionId: id,
      headers: await headers(),
    });
    await deleteSession({ sessionId: id, workspaceId, organizationId });
    return Response.json({ ok: true });
  },
);
