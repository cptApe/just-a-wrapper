import { headers } from 'next/headers';
import { z } from 'zod';
import { updateBrowserTimeZone } from '@/features/preferences/server';
import { scheduleCreatorTaskSync } from '@/features/tasks/server';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';

const Body = z.object({ timezone: z.string().trim().min(1).max(64) });

export const PATCH = withApiRoute(
  { route: 'api/preferences/timezone', feature: 'preferences' },
  async (request) => {
    const body = await parseJsonBody(request, Body);
    const result = await updateBrowserTimeZone({ headers: await headers(), ...body });
    // A person on Auto moved zones: their scheduled tasks hear it now, not on the daily sweep.
    if (result.zoneChanged) scheduleCreatorTaskSync(result.userId);
    return Response.json({ timezone: result.timezone });
  },
);
