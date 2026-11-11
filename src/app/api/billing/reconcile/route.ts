import { headers } from 'next/headers';
import { z } from 'zod';
import {
  reconcileCheckoutSession,
  reconcileCurrentSubscription,
  requireBillingAdmin,
} from '@/features/billing';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';

const bodySchema = z.object({ checkoutSessionId: z.string().min(1).nullable() });
export const runtime = 'nodejs';
export const POST = withApiRoute(
  { route: 'api/billing/reconcile', feature: 'billing', reportExpectedErrors: true },
  async (request) => {
    const workspace = await requireBillingAdmin(await headers());
    const body = await parseJsonBody(request, bodySchema);
    const result =
      body.checkoutSessionId === null
        ? await reconcileCurrentSubscription(workspace)
        : await reconcileCheckoutSession({ workspace, checkoutSessionId: body.checkoutSessionId });
    return Response.json({
      status: result.kind,
      purchase:
        result.kind === 'applied' || result.kind === 'unchanged'
          ? (result.result.body.purchase ?? null)
          : null,
    });
  },
);
