import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';
import { withApiRoute } from '@/lib/route-kit';

const handlers = toNextJsHandler(auth);
export const GET = withApiRoute({ route: 'auth' }, async (request) => handlers.GET(request));
export const POST = withApiRoute({ route: 'auth' }, async (request) => handlers.POST(request));
