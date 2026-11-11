import { headers } from 'next/headers';
import { z } from 'zod';
import { requireBillingAdmin, updateBillingMemberLimit } from '@/features/billing';
import { assertExpectedOrganization } from '@/lib/assert-expected-organization';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';

const Body = z.object({
  expectedOrganizationId: z.string().min(1),
  userId: z.string().min(1),
  creditLimit: z.number().int().nonnegative().nullable(),
});

export const PATCH = withApiRoute(
  { route: 'api/billing/member-limit', feature: 'billing', reportExpectedErrors: true },
  async (request) => {
    const workspace = await requireBillingAdmin(await headers());
    const body = await parseJsonBody(request, Body);
    assertExpectedOrganization(workspace.organizationId, body.expectedOrganizationId);
    const result = await updateBillingMemberLimit({ workspace, ...body });
    return Response.json(result);
  },
);
