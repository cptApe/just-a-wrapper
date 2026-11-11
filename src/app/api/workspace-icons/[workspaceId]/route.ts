import { z } from 'zod';
import { readProfileImage } from '@/features/files/server';
import { parseRouteParams, withApiRoute } from '@/lib/route-kit';
export const GET = withApiRoute(
  { route: 'api/workspace-icons/[workspaceId]', feature: 'files' },
  async (request, context) => {
    const { workspaceId } = await parseRouteParams(
      context.params,
      z.object({ workspaceId: z.uuid() }),
    );
    return readProfileImage(request, 'workspace-icon', workspaceId);
  },
);
