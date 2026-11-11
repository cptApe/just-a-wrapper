import { headers } from 'next/headers';
import { z } from 'zod';
import { planChoiceSchema, previewPlanChange, requireBillingAdmin } from '@/features/billing';
import { assertExpectedOrganization } from '@/lib/assert-expected-organization';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';

const Body = planChoiceSchema.extend({ expectedOrganizationId: z.string().min(1) });

export const POST = withApiRoute(
  { route: 'api/billing/plan/preview', feature: 'billing', reportExpectedErrors: true },
  async (request) => {
    const workspace = await requireBillingAdmin(await headers());
    const { expectedOrganizationId, ...choice } = await parseJsonBody(request, Body);
    assertExpectedOrganization(workspace.organizationId, expectedOrganizationId);
    return Response.json(await previewPlanChange({ workspace, choice }));
  },
);
