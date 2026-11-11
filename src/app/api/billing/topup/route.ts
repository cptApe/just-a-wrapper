import { headers } from 'next/headers';
import { z } from 'zod';
import {
  chargeTopup,
  getTopupOptions,
  isTopupCredits,
  requireBillingAdmin,
} from '@/features/billing';
import { assertExpectedOrganization } from '@/lib/assert-expected-organization';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';

const Body = z.object({
  expectedOrganizationId: z.string().min(1),
  credits: z.number().refine(isTopupCredits),
  idempotencyKey: z.string().min(1).max(255),
});

export const GET = withApiRoute(
  { route: 'api/billing/topup', feature: 'billing', reportExpectedErrors: true },
  async () => {
    const workspace = await requireBillingAdmin(await headers());
    return Response.json(await getTopupOptions(workspace));
  },
);

export const POST = withApiRoute(
  { route: 'api/billing/topup', feature: 'billing', reportExpectedErrors: true },
  async (request) => {
    const workspace = await requireBillingAdmin(await headers());
    const { credits, idempotencyKey, expectedOrganizationId } = await parseJsonBody(request, Body);
    assertExpectedOrganization(workspace.organizationId, expectedOrganizationId);
    const result = await chargeTopup({ workspace, credits, idempotencyKey });
    return Response.json(result);
  },
);
