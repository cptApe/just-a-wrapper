import { experimental_generateVideo as generateVideo } from 'ai';
import { z } from 'zod';
import { VIDEO_MODEL_ID } from '@/features/tool-catalog/generate-video';
import type { MediaCapability } from '@/lib/capabilities';
import { IntegrationError } from '@/lib/errors';
import { gatewayGenerationId, mediaGateway } from '@/lib/media-gateway';

const videoSchema = z.object({
  uint8Array: z.instanceof(Uint8Array),
  mediaType: z.literal('video/mp4'),
});

export async function generateGatewayVideo(
  capability: MediaCapability,
  input: {
    prompt: string;
    duration: number;
    aspectRatio: `${number}:${number}`;
    resolution: `${number}x${number}`;
  },
) {
  const gateway = mediaGateway(capability);
  try {
    const generated = await generateVideo({
      model: gateway.videoModel(VIDEO_MODEL_ID),
      ...input,
      generateAudio: true,
      maxRetries: 0,
      // Leave time for Library storage before the dispatch route deadline.
      abortSignal: AbortSignal.timeout(240_000),
    });
    const video = videoSchema.parse(generated.video);
    return {
      bytes: video.uint8Array,
      generationId: gatewayGenerationId(generated.providerMetadata),
    };
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Gateway video generation failed',
      { model: VIDEO_MODEL_ID },
      { cause },
    );
  }
}
