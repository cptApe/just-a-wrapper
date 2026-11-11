import { unsavedMediaError } from '../lib/paid-tool-error';
// Import into the Library before returning so the agent receives a durable workspace URL.
// The dispatcher gates the run on the estimate below and bills the completed request after delivery.
import 'server-only';
import { creditsForVendorCents } from '@/features/billing/lib/credit-math';
import { MEDIA_ESTIMATE_CENTS } from '@/features/billing/pricing-config';
import { importDriveFile } from '@/features/files/api/import-drive-file';
import { GENERATED_IMAGES_FOLDER_PATH } from '@/features/files/lib/paths';
import { resolveToolSettings } from '@/features/permissions/api/custom-tool-policy';
import { resolveEffectiveQuality } from '@/features/permissions/lib/tool-settings';
import {
  GENERATE_IMAGE_DECL,
  GENERATE_IMAGE_NAME,
  type GenerateImageInput,
  GenerateImageInputSchema,
  type GenerateImageOutput,
  GenerateImageOutputSchema,
  IMAGE_MODEL_ID,
  IMAGE_QUALITY,
  IMAGE_SIZE,
} from '@/features/tool-catalog/generate-image';
import type { CustomTool } from '@/features/tool-catalog/types';
import { capabilities } from '@/lib/runtime-capabilities';
import { generateGatewayImage } from '../lib/gateway-image';

function filenameFromPrompt(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return `${slug || 'generated-image'}.png`;
}

export const generateImageTool: CustomTool<GenerateImageInput, GenerateImageOutput> = {
  ...GENERATE_IMAGE_DECL,
  inputSchema: GenerateImageInputSchema,
  outputSchema: GenerateImageOutputSchema,
  accrualSource: 'generation',
  mediaBilling: (output) => output.mediaBilling,
  estimateCredits: ({ quality }, settings) =>
    creditsForVendorCents(
      MEDIA_ESTIMATE_CENTS[IMAGE_MODEL_ID][
        resolveEffectiveQuality(quality, settings.defaultQuality)
      ],
    ),
  async handler({ prompt, quality, size }, ctx) {
    const settings = await resolveToolSettings({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      toolName: GENERATE_IMAGE_NAME,
    });
    // Mid uses the stored preference; an explicit low or high request wins.
    const effectiveQuality = resolveEffectiveQuality(quality, settings.defaultQuality);
    const estimatedCostCents = MEDIA_ESTIMATE_CENTS[IMAGE_MODEL_ID][effectiveQuality];
    const generated = await generateGatewayImage(capabilities.media, {
      prompt,
      quality: IMAGE_QUALITY[effectiveQuality],
      size: IMAGE_SIZE[size],
    });
    const bytes = generated.bytes;

    const saved = await importDriveFile({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      bytes,
      filename: filenameFromPrompt(prompt),
      mimeType: 'image/png',
      folderPath: GENERATED_IMAGES_FOLDER_PATH,
      source: 'agent_generated',
      sessionId: ctx.sessionRowId,
    }).catch((cause: unknown) => {
      throw unsavedMediaError(
        { generationId: generated.generationId, model: IMAGE_MODEL_ID, estimatedCostCents },
        cause,
      );
    });

    return {
      model: IMAGE_MODEL_ID,
      image: {
        url: saved.url,
        filename: saved.filename,
        folderPath: saved.folderPath,
      },
      quality: effectiveQuality,
      size,
      mediaBilling: {
        generationId: generated.generationId,
        model: IMAGE_MODEL_ID,
        estimatedCostCents,
      },
    };
  },
};
