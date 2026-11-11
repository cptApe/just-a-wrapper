import { headers } from 'next/headers';
import { z } from 'zod';
import { cancelPlan, requireBillingAdmin } from '@/features/billing';
import { assertExpectedOrganization } from '@/lib/assert-expected-organization';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';

const Body = z.object({ expectedOrganizationId: z.string().min(1), resume: z.boolean() });

export const POST = withApiRoute(
  { route: 'api/billing/plan/cancel', feature: 'billing', reportExpectedErrors: true },
  async (request) => {
    const workspace = await requireBillingAdmin(await headers());
    const { expectedOrganizationId, resume } = await parseJsonBody(request, Body);
    assertExpectedOrganization(workspace.organizationId, expectedOrganizationId);
    return Response.json(await cancelPlan({ workspace, resume }));
  },
);
