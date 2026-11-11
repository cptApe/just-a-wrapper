import { headers } from 'next/headers';
import { z } from 'zod';
import { requireBillingAdmin, updateAutoTopupSettings } from '@/features/billing';
import { AUTO_TOPUP, monthlyCapError } from '@/features/billing/server';
import { assertExpectedOrganization } from '@/lib/assert-expected-organization';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';

const Body = z
  .object({
    expectedOrganizationId: z.string().min(1),
    enabled: z.boolean(),
    thresholdCredits: z.number().int().positive(),
    credits: z.number().int().positive(),
    monthlyCapDollars: z
      .number()
      .int()
      .nonnegative()
      .max(AUTO_TOPUP.maxMonthlyCapCents / 100),
  })
  .refine((body) => monthlyCapError(body) === null, {
    path: ['monthlyCapDollars'],
    message: 'That monthly limit cannot be saved.',
  });

export const PATCH = withApiRoute(
  { route: 'api/billing/auto-topup', feature: 'billing', reportExpectedErrors: true },
  async (request) => {
    const workspace = await requireBillingAdmin(await headers());
    const settings = await parseJsonBody(request, Body);
    assertExpectedOrganization(workspace.organizationId, settings.expectedOrganizationId);
    return Response.json(await updateAutoTopupSettings({ workspace, settings }));
  },
);
