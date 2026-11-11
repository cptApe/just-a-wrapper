import { headers } from 'next/headers';
import { z } from 'zod';
import { changePlan, planChoiceSchema, requireBillingAdmin } from '@/features/billing';
import { assertExpectedOrganization } from '@/lib/assert-expected-organization';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';

const Body = planChoiceSchema.extend({
  expectedOrganizationId: z.string().min(1),
  confirmation: z
    .object({
      prorationDate: z.number().int().positive(),
      amountCents: z.number().int().nonnegative(),
    })
    .optional(),
});

export const POST = withApiRoute(
  { route: 'api/billing/plan/change', feature: 'billing', reportExpectedErrors: true },
  async (request) => {
    const workspace = await requireBillingAdmin(await headers());
    const { expectedOrganizationId, confirmation, ...choice } = await parseJsonBody(request, Body);
    assertExpectedOrganization(workspace.organizationId, expectedOrganizationId);
    return Response.json(await changePlan({ workspace, choice, confirmation }));
  },
);
