import { realtimeStream } from '@/features/realtime/server';
import { resolveCaller } from '@/lib/caller';
import { withApiRoute } from '@/lib/route-kit';
export const runtime = 'nodejs';
// STREAM_LIFETIME_MS ends the stream before this platform limit.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const GET = withApiRoute({ route: 'api/realtime/stream' }, async (request) =>
  realtimeStream(request, await resolveCaller(request.headers)),
);
