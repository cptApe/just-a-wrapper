import { headers } from 'next/headers';
import { z } from 'zod';
import { sessionRouteErrorResponse } from '@/features/sessions';
import { listPendingConfirmations, resolveDispatchContext } from '@/features/tools/server';
import { parseSearchParams, withApiRoute } from '@/lib/route-kit';

// GET /api/custom-tools/pending?sessionId=… — the still-pending destructive
// confirmations for a session, enriched with tool metadata. The chat stepper reads
// this (a query, not client memory) so a reload or second tab sees the same queue.

export const runtime = 'nodejs';

const Query = z.object({ sessionId: z.string().min(1) });

export const GET = withApiRoute(
  {
    route: 'api/custom-tools/pending',
    feature: 'tooling',
    errorResponse: sessionRouteErrorResponse,
  },
  async (request) => {
    const { sessionId } = parseSearchParams(request, Query);
    const ctx = await resolveDispatchContext(await headers(), sessionId);
    const pending = await listPendingConfirmations(ctx.sessionRowId);
    return Response.json({ pending });
  },
);
