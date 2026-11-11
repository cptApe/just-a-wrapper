import { z } from 'zod';
import { readProfileImage } from '@/features/files/server';
import { parseRouteParams, withApiRoute } from '@/lib/route-kit';
export const GET = withApiRoute(
  { route: 'api/avatars/[userId]', feature: 'files' },
  async (request, context) => {
    const { userId } = await parseRouteParams(
      context.params,
      z.object({ userId: z.string().min(1) }),
    );
    return readProfileImage(request, 'avatar', userId);
  },
);
