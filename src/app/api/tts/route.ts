import { headers } from 'next/headers';
import { z } from 'zod';
import { authorizeSessionAccess } from '@/features/sessions';
import { MAX_TTS_CHARS } from '@/features/voice';
import { synthesizeForReadAloud } from '@/features/voice/server';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const Body = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(MAX_TTS_CHARS),
});

export const POST = withApiRoute({ route: 'api/tts' }, async (request) => {
  const { sessionId, text } = await parseJsonBody(request, Body);
  const access = await authorizeSessionAccess({ sessionId, headers: await headers() });
  const speech = await synthesizeForReadAloud({ ...access, text });
  return new Response(speech.body, {
    headers: { 'content-type': speech.contentType, 'cache-control': 'no-store' },
  });
});
