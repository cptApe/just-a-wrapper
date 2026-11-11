import { generateImage } from 'ai';
import { z } from 'zod';
import { imageModelForBackground } from '@/features/tool-catalog/generate-image';
import type { MediaCapability } from '@/lib/capabilities';
import { IntegrationError } from '@/lib/errors';
import { gatewayGenerationId, mediaGateway } from '@/lib/media-gateway';

const imageSchema = z.object({
  uint8Array: z.instanceof(Uint8Array),
  mediaType: z.literal('image/png'),
});

export async function generateGatewayImage(
  capability: MediaCapability,
  input: {
    prompt: string;
    quality: 'low' | 'medium' | 'high';
    size?: `${number}x${number}`;
    images?: string[];
    mask?: string;
    background?: 'auto' | 'transparent' | 'opaque';
  },
) {
  const gateway = mediaGateway(capability);
  const model = imageModelForBackground(input.background);
  try {
    const generated = await generateImage({
      model: gateway.imageModel(model),
      prompt: input.images
        ? { text: input.prompt, images: input.images, ...(input.mask ? { mask: input.mask } : {}) }
        : input.prompt,
      ...(input.size ? { size: input.size } : {}),
      providerOptions: {
        openai: {
          quality: input.quality,
          output_format: 'png',
          ...(input.background ? { background: input.background } : {}),
        },
      },
      maxRetries: 0,
      // High-quality image requests need time to complete within the dispatch deadline.
      abortSignal: AbortSignal.timeout(180_000),
    });
    const image = imageSchema.parse(generated.image);
    const call = generated.calls.at(0);
    return {
      model,
      bytes: Uint8Array.from(image.uint8Array),
      generationId: gatewayGenerationId(call?.providerMetadata),
    };
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Gateway image generation failed',
      { model },
      { cause },
    );
  }
}
