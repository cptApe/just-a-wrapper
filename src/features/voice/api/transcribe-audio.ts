import 'server-only';
import { transcribe } from 'ai';
import { z } from 'zod';
import type { MediaCapability } from '@/lib/capabilities';
import { IntegrationError } from '@/lib/errors';
import { gatewayGenerationId, mediaGateway } from '@/lib/media-gateway';

import { STT_MODEL_ID } from '../lib/voice-contract';

const transcriptSchema = z.object({
  text: z.string(),
  durationInSeconds: z.number().positive(),
  language: z.string().optional(),
});

export async function transcribeAudio(capability: MediaCapability, input: { file: File }) {
  const gateway = mediaGateway(capability);
  try {
    const transcription = await transcribe({
      model: gateway.transcriptionModel(STT_MODEL_ID),
      // Composer dictation wants words, not [laughter] markers.
      providerOptions: { elevenlabs: { tagAudioEvents: false } },
      audio: new Uint8Array(await input.file.arrayBuffer()),
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(180_000),
    });
    const transcript = transcriptSchema.parse(transcription);
    return {
      text: transcript.text.trim(),
      audioSeconds: transcript.durationInSeconds,
      language: transcript.language,
      generationId: gatewayGenerationId(transcription.providerMetadata),
    };
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Gateway transcription failed',
      { model: STT_MODEL_ID },
      { cause },
    );
  }
}
