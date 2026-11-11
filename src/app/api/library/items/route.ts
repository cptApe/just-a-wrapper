import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { loadLibraryItems } from '@/features/files/server';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { routeErrorResponse, withApiRoute } from '@/lib/route-kit';

// Load previewable Library items for the caller workspace.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    route: 'api/library/items',
    feature: 'files',
    errorResponse(error) {
      const response = routeErrorResponse(error);
      return new Response(response.body, {
        status:
          error instanceof AppError && error.code === 'WORKSPACE_NOT_FOUND' ? 401 : response.status,
        headers: { ...Object.fromEntries(response.headers), 'cache-control': 'no-store' },
      });
    },
  },
  async () => {
    const { workspaceId, userId } = await resolveCaller(await headers());
    return NextResponse.json(await loadLibraryItems(workspaceId, userId), {
      headers: { 'cache-control': 'no-store' },
    });
  },
);
