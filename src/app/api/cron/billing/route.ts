import { runBillingRecovery } from '@/features/jobs/server';
import { assertCronRequest, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const GET = withApiRoute(
  { route: 'api/cron/billing', feature: 'billing', reportExpectedErrors: true },
  async (request) => {
    assertCronRequest(request);
    await runBillingRecovery();
    return Response.json({ reconciled: true });
  },
);
