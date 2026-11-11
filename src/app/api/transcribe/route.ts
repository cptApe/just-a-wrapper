import { headers } from 'next/headers';
import { MAX_AUDIO_BYTES } from '@/features/voice';
import { transcribeForComposer } from '@/features/voice/server';
import { resolveCaller } from '@/lib/caller';
import { withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = withApiRoute({ route: 'api/transcribe' }, async (request) => {
  const caller = await resolveCaller(await headers());
  const form = await request.formData();
  const audio = form.get('audio');
  if (!(audio instanceof File) || audio.size === 0) {
    return Response.json(
      { error: { code: 'INVALID_BODY', message: 'An audio file is required' } },
      { status: 400 },
    );
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json(
      { error: { code: 'AUDIO_TOO_LARGE', message: 'Audio exceeds the upload limit' } },
      { status: 413 },
    );
  }
  return Response.json(await transcribeForComposer({ ...caller, audio }));
});
