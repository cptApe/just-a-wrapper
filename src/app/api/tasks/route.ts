import { headers } from 'next/headers';
import { createTask } from '@/features/tasks';
import { CreateTaskBody } from '@/features/tasks/server';
import { resolveCaller } from '@/lib/caller';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';

// POST /api/tasks — create a scheduled or event-triggered task. Parse → auth →
// call feature → return the new task id. Schedule tasks create an Anthropic
// Scheduled Deployment; event tasks register a Composio trigger instance.

export const runtime = 'nodejs';
// Deployment create includes a skills sync + agent pin round-trip.
export const maxDuration = 60;

export const POST = withApiRoute({ route: 'api/tasks', feature: 'tasks' }, async (request) => {
  const { workspaceId, userId, organizationId } = await resolveCaller(await headers());
  const taskInput = await parseJsonBody(request, CreateTaskBody);

  const trigger =
    taskInput.triggerType === 'event'
      ? taskInput
      : taskInput.runAt
        ? { ...taskInput, cron: undefined, runAt: taskInput.runAt }
        : { ...taskInput, runAt: undefined, cron: taskInput.cron ?? '' };
  const { taskId } = await createTask({
    ...trigger,
    workspaceId,
    createdByUserId: userId,
    organizationId,
  });
  return Response.json({ taskId });
});
