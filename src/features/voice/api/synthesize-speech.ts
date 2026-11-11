import 'server-only';
import { generateSpeech } from 'ai';
import { z } from 'zod';
import type { MediaCapability } from '@/lib/capabilities';
import { IntegrationError } from '@/lib/errors';
import { gatewayGenerationId, mediaGateway } from '@/lib/media-gateway';
import { TTS_MODEL_ID } from '../lib/voice-contract';

const speechSchema = z.object({ uint8Array: z.instanceof(Uint8Array) });

export async function synthesizeSpeech(
  capability: MediaCapability,
  input: { text: string; voiceId: string },
) {
  const gateway = mediaGateway(capability);
  try {
    const speech = await generateSpeech({
      model: gateway.speechModel(TTS_MODEL_ID),
      text: input.text,
      voice: input.voiceId,
      outputFormat: 'mp3',
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(180_000),
    });
    const audio = speechSchema.parse(speech.audio);
    return {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(audio.uint8Array);
          controller.close();
        },
      }),
      contentType: 'audio/mpeg',
      generationId: gatewayGenerationId(speech.providerMetadata),
    };
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Gateway speech synthesis failed',
      { model: TTS_MODEL_ID },
      { cause },
    );
  }
}
