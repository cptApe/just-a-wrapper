import { headers } from 'next/headers';
import { getPlanOptions, requireBillingAdmin } from '@/features/billing';
import { withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';

export const GET = withApiRoute(
  { route: 'api/billing/plan', feature: 'billing', reportExpectedErrors: true },
  async () => {
    const workspace = await requireBillingAdmin(await headers());
    return Response.json(await getPlanOptions(workspace));
  },
);
