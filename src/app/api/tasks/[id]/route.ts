import { headers } from 'next/headers';
import { z } from 'zod';
import { deleteTask, getTaskForEdit, updateTask } from '@/features/tasks';
import { PatchTaskBody } from '@/features/tasks/server';
import { resolveCaller } from '@/lib/caller';
import { parseJsonBody, parseRouteParams, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';
// A schedule edit re-resolves member context + updates the deployment.
export const maxDuration = 60;

export const GET = withApiRoute(
  { route: 'api/tasks/get', feature: 'tasks' },
  async (_request, context) => {
    const { workspaceId, userId } = await resolveCaller(await headers());
    const { id } = await parseRouteParams(context.params, taskParams);
    const task = await getTaskForEdit({ taskId: id, workspaceId, userId });
    return Response.json({ task });
  },
);

export const PATCH = withApiRoute(
  { route: 'api/tasks/update', feature: 'tasks' },
  async (request, context) => {
    const { workspaceId, organizationId, userId } = await resolveCaller(await headers());
    const { id } = await parseRouteParams(context.params, taskParams);
    const { version, ...taskInput } = await parseJsonBody(request, PatchTaskBody);
    const saved = await updateTask({
      ...taskInput,
      expectedVersion: version,
      taskId: id,
      workspaceId,
      organizationId,
      userId,
    });
    return Response.json({ ok: true, version: saved.version });
  },
);

export const DELETE = withApiRoute(
  { route: 'api/tasks/delete', feature: 'tasks' },
  async (_request, context) => {
    const { workspaceId, userId } = await resolveCaller(await headers());
    const { id } = await parseRouteParams(context.params, taskParams);
    await deleteTask({ taskId: id, workspaceId, userId });
    return Response.json({ ok: true });
  },
);

const taskParams = z.object({ id: z.string() });
