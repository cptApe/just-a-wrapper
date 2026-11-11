import { runRecoverySweeps } from '@/features/jobs/server';
import { assertCronRequest, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const GET = withApiRoute(
  { route: 'api/cron/recovery', feature: 'sessions' },
  async (request) => {
    assertCronRequest(request);
    return Response.json(await runRecoverySweeps());
  },
);
