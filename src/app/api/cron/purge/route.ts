import { z } from 'zod';
import { runPurgeJobs } from '@/features/workspaces/server';
import { assertCronRequest, parseSearchParams, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';
export const maxDuration = 300;

const Query = z.object({ dryRun: z.literal('true').optional() });

export const GET = withApiRoute(
  { route: 'api/cron/purge', feature: 'workspaces' },
  async (request) => {
    assertCronRequest(request);
    const { dryRun } = parseSearchParams(request, Query);
    const { report, failed } = await runPurgeJobs({ dryRun: dryRun === 'true' });
    return Response.json(report, { status: failed ? 500 : 200 });
  },
);
