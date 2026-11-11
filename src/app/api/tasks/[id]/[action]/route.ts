import { headers } from 'next/headers';
import { z } from 'zod';
import { pauseTask, resumeTask, runTaskNow } from '@/features/tasks';
import { resolveCaller } from '@/lib/caller';
import { parseRouteParams, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';
// run-now waits on the deployment run + session retrieve round-trip.
export const maxDuration = 60;

export const POST = withApiRoute(
  { route: 'api/tasks/action', feature: 'tasks' },
  async (_request, context) => {
    const { id, action } = await parseRouteParams(context.params, taskParams);
    const { workspaceId, userId } = await resolveCaller(await headers());
    switch (action) {
      case 'pause':
        await pauseTask({ taskId: id, workspaceId, userId });
        return Response.json({ ok: true });
      case 'resume':
        await resumeTask({ taskId: id, workspaceId, userId });
        return Response.json({ ok: true });
      case 'run': {
        // Return ok only; upstream session ids remain internal.
        await runTaskNow({ taskId: id, workspaceId, userId });
        return Response.json({ ok: true });
      }
    }
  },
);

const taskParams = z.object({ id: z.string(), action: z.enum(['pause', 'resume', 'run']) });
