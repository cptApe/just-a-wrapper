import { processProfileImage, profileImageBody } from '@/features/files/server';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';

export const POST = withApiRoute(
  { route: 'api/files/profile-image', feature: 'files' },
  async (request) => {
    const body = await parseJsonBody(request, profileImageBody);
    return Response.json(await processProfileImage(request, body));
  },
);
