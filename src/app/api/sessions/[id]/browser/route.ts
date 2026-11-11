import { headers } from 'next/headers';
import { z } from 'zod';
import { sessionRouteErrorResponse } from '@/features/sessions';
import {
  authorizeBrowserControl,
  getTaskBrowserView,
  renewBrowserControlLease,
  sendBrowserControlSignal,
} from '@/features/tools/server';
import { parseJsonBody, parseRouteParams, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';

const ControlBody = z.object({ controlledByUser: z.boolean() });

// Browserbase's API key remains server-side; only its ephemeral debugger URL
// crosses this authorized task boundary.
export const GET = withApiRoute(
  {
    route: 'api/sessions/[id]/browser',
    feature: 'tooling',
    errorResponse: sessionRouteErrorResponse,
  },
  async (_request, routeContext) => {
    const { id } = await parseRouteParams(routeContext.params, z.object({ id: z.string() }));
    const grant = await authorizeBrowserControl(await headers(), id);
    return Response.json(await getTaskBrowserView(grant.sessionRowId, id));
  },
);

// Take control / Hand back is posted as a user.message for the agent, and the
// relay translates that fenced message into a quiet thread whisper.
export const POST = withApiRoute(
  {
    route: 'api/sessions/[id]/browser',
    feature: 'tooling',
    errorResponse: sessionRouteErrorResponse,
  },
  async (request, routeContext) => {
    const body = await parseJsonBody(request, ControlBody);
    const { id } = await parseRouteParams(routeContext.params, z.object({ id: z.string() }));
    const grant = await authorizeBrowserControl(await headers(), id);
    await sendBrowserControlSignal(grant, body.controlledByUser);
    return Response.json({ ok: true });
  },
);

export const PATCH = withApiRoute(
  {
    route: 'api/sessions/[id]/browser/renew',
    feature: 'tooling',
    errorResponse: sessionRouteErrorResponse,
  },
  async (_request, routeContext) => {
    const { id } = await parseRouteParams(routeContext.params, z.object({ id: z.string() }));
    const grant = await authorizeBrowserControl(await headers(), id);
    await renewBrowserControlLease(grant);
    return Response.json({ ok: true });
  },
);
