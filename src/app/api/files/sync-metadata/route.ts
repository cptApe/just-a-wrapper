import { syncUploadBody, syncUploadRequest } from '@/features/files/server';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';
export const runtime = 'nodejs';
export const POST = withApiRoute(
  { route: 'api/files/sync-metadata', feature: 'files' },
  async (request) => {
    const body = await parseJsonBody(request, syncUploadBody);
    return Response.json(await syncUploadRequest(request, body));
  },
);
