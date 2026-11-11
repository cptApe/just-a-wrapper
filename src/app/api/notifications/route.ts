import {
  feedInputSchema,
  markNotificationsRead,
  readInputSchema,
  readNotificationFeed,
} from '@/features/notifications/server';
import { resolveCaller } from '@/lib/caller';
import { parseJsonBody, parseSearchParams, withApiRoute } from '@/lib/route-kit';
export const GET = withApiRoute({ route: 'api/notifications' }, async (request) => {
  const input = parseSearchParams(request, feedInputSchema);
  return Response.json(await readNotificationFeed(await resolveCaller(request.headers), input));
});
export const POST = withApiRoute({ route: 'api/notifications/read' }, async (request) => {
  const identity = await resolveCaller(request.headers);
  const input = await parseJsonBody(request, readInputSchema);
  await markNotificationsRead(identity, input);
  return Response.json({ ok: true });
});
