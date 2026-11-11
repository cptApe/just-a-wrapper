import { authorizeUpload, uploadBody } from '@/features/files/server';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';

export const POST = withApiRoute(
  { route: 'api/files/upload-token', feature: 'files' },
  async (request) => {
    const body = await parseJsonBody(request, uploadBody);
    return Response.json(await authorizeUpload(request, body));
  },
);
