import { unsavedMediaError } from '../lib/paid-tool-error';
// Persist video in the Library so provider hosting cannot expire links in the conversation.
// The dispatcher gates the run on the estimate below and bills only completed output after delivery.
import 'server-only';
import { creditsForVendorCents } from '@/features/billing/lib/credit-math';
import { MEDIA_ESTIMATE_CENTS } from '@/features/billing/pricing-config';
import { importDriveFile } from '@/features/files/api/import-drive-file';
import { GENERATED_VIDEOS_FOLDER_PATH } from '@/features/files/lib/paths';
import { resolveToolSettings } from '@/features/permissions/api/custom-tool-policy';
import {
  type GenerationQuality,
  resolveEffectiveQuality,
} from '@/features/permissions/lib/tool-settings';
import {
  GENERATE_VIDEO_DECL,
  GENERATE_VIDEO_NAME,
  type GenerateVideoInput,
  GenerateVideoInputSchema,
  type GenerateVideoOutput,
  GenerateVideoOutputSchema,
  VIDEO_ASPECT,
  VIDEO_MODEL_ID,
  VIDEO_RESOLUTION,
} from '@/features/tool-catalog/generate-video';
import type { CustomTool } from '@/features/tool-catalog/types';
import { capabilities } from '@/lib/runtime-capabilities';
import { generateGatewayVideo } from '../lib/gateway-video';

function filenameFromPrompt(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return `${slug || 'generated-video'}.mp4`;
}

function videoEstimateCents(
  quality: GenerateVideoInput['quality'],
  duration: GenerateVideoInput['duration'],
  storedDefault: GenerationQuality | undefined,
): number {
  const effectiveQuality = resolveEffectiveQuality(quality, storedDefault);
  return MEDIA_ESTIMATE_CENTS[VIDEO_MODEL_ID].perSecond[effectiveQuality] * Number(duration);
}

export const generateVideoTool: CustomTool<GenerateVideoInput, GenerateVideoOutput> = {
  ...GENERATE_VIDEO_DECL,
  inputSchema: GenerateVideoInputSchema,
  outputSchema: GenerateVideoOutputSchema,
  accrualSource: 'generation',
  mediaBilling: (output) => output.mediaBilling,
  estimateCredits: ({ quality, duration }, settings) =>
    creditsForVendorCents(videoEstimateCents(quality, duration, settings.defaultQuality)),
  async handler({ prompt, quality, duration, aspect }, ctx) {
    const settings = await resolveToolSettings({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      toolName: GENERATE_VIDEO_NAME,
    });
    // Mid uses the stored preference; an explicit low or high request wins.
    const effectiveQuality = resolveEffectiveQuality(quality, settings.defaultQuality);
    const estimatedCostCents = videoEstimateCents(quality, duration, settings.defaultQuality);
    const generated = await generateGatewayVideo(capabilities.media, {
      prompt,
      duration: Number(duration),
      aspectRatio: VIDEO_ASPECT[aspect],
      resolution: VIDEO_RESOLUTION[effectiveQuality],
    });
    const bytes = generated.bytes;

    const saved = await importDriveFile({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      bytes,
      filename: filenameFromPrompt(prompt),
      mimeType: 'video/mp4',
      folderPath: GENERATED_VIDEOS_FOLDER_PATH,
      source: 'agent_generated',
      sessionId: ctx.sessionRowId,
    }).catch((cause: unknown) => {
      throw unsavedMediaError(
        { generationId: generated.generationId, model: VIDEO_MODEL_ID, estimatedCostCents },
        cause,
      );
    });

    return {
      video: {
        url: saved.url,
        filename: saved.filename,
        folderPath: saved.folderPath,
        sizeBytes: bytes.byteLength,
      },
      quality: effectiveQuality,
      duration,
      aspect,
      mediaBilling: {
        generationId: generated.generationId,
        model: VIDEO_MODEL_ID,
        estimatedCostCents,
      },
    };
  },
};
