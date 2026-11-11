import { z } from 'zod';
import { readFileContent } from '@/features/files/server';
import { parseRouteParams, withApiRoute } from '@/lib/route-kit';

export const GET = withApiRoute(
  { route: 'api/files/[id]/thumbnail', feature: 'files' },
  async (request, context) => {
    const { id } = await parseRouteParams(context.params, z.object({ id: z.uuid() }));
    return readFileContent(request, id, 'thumbnail');
  },
);
