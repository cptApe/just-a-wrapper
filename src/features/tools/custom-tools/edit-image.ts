import { unsavedMediaError } from '../lib/paid-tool-error';
import 'server-only';
import { creditsForVendorCents } from '@/features/billing/lib/credit-math';
import { MEDIA_ESTIMATE_CENTS } from '@/features/billing/pricing-config';
import { claimArtifactSave } from '@/features/files/api/artifact-transitions';
import { signedBlobUrl } from '@/features/files/api/blob-storage';
import { importDriveFile } from '@/features/files/api/import-drive-file';
import { discardImportedFile } from '@/features/files/api/trash-transitions';
import { GENERATED_IMAGES_FOLDER_PATH } from '@/features/files/lib/paths';
import { resolveToolSettings } from '@/features/permissions/api/custom-tool-policy';
import {
  type GenerationQuality,
  resolveEffectiveQuality,
} from '@/features/permissions/lib/tool-settings';
import {
  EDIT_IMAGE_DECL,
  EDIT_IMAGE_NAME,
  type EditImageInput,
  EditImageInputSchema,
  type EditImageOutput,
  EditImageOutputSchema,
  type EditImageSource,
} from '@/features/tool-catalog/edit-image';
import { IMAGE_QUALITY, imageModelForBackground } from '@/features/tool-catalog/generate-image';
import type { CustomTool } from '@/features/tool-catalog/types';
import { ToolError } from '@/lib/errors';
import { capabilities } from '@/lib/runtime-capabilities';
import { resolveToolFile } from '../api/file-resolver';
import { editImageOptions } from '../lib/edit-image-options';
import { fetchPublicResource } from '../lib/fetch-public-resource';
import { generateGatewayImage } from '../lib/gateway-image';
import { assertPublicTarget } from '../lib/url-guard';

const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const SOURCE_CONCURRENCY = 4;
const MAX_SOURCE_REDIRECTS = 5;

type ToolContext = Parameters<CustomTool['handler']>[1];

function imageTooLarge(sizeBytes: number): ToolError {
  return new ToolError('TOOL_INPUT_INVALID', 'The source image exceeds the 25 MB limit', {
    sizeBytes,
    maxBytes: MAX_IMAGE_BYTES,
  });
}

async function readCappedImageBytes(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
    throw imageTooLarge(declaredSize);
  }
  if (!response.body)
    throw new ToolError('TOOL_INPUT_INVALID', 'The source image has no body', {
      url: response.url,
    });

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let sizeBytes = 0;
  let chunk = await reader.read();
  while (!chunk.done) {
    const value = chunk.value;
    sizeBytes += value.byteLength;
    if (sizeBytes > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw imageTooLarge(sizeBytes);
    }
    chunks.push(value);
    chunk = await reader.read();
  }
  const bytes = new Uint8Array(sizeBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function resolveSources(sources: EditImageSource[], ctx: ToolContext): Promise<string[]> {
  const resolved: string[] = [];
  for (let index = 0; index < sources.length; index += SOURCE_CONCURRENCY) {
    resolved.push(
      ...(await Promise.all(
        sources
          .slice(index, index + SOURCE_CONCURRENCY)
          .map((source) => resolveSource(source, ctx)),
      )),
    );
  }
  return resolved;
}

function sourceFilename(mimeType: string): string {
  const extension =
    {
      'image/avif': 'avif',
      'image/gif': 'gif',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    }[mimeType] ?? 'img';
  return `source-image.${extension}`;
}

async function importHttpsSource(rawUrl: string, ctx: ToolContext): Promise<string> {
  const { response, url: currentUrl } = await fetchPublicResource(
    rawUrl,
    MAX_SOURCE_REDIRECTS,
    DOWNLOAD_TIMEOUT_MS,
    fetch,
    assertPublicTarget,
  );
  if (!response.ok) {
    throw new ToolError('TOOL_INPUT_INVALID', 'The source image could not be fetched', {
      url: currentUrl.toString(),
      status: response.status,
    });
  }

  const mimeType =
    response.headers.get('content-type')?.split(';').at(0)?.trim().toLowerCase() ?? '';
  assertImage(mimeType, 'The URL response');
  const bytes = await readCappedImageBytes(response);
  const saved = await importDriveFile({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    bytes,
    filename: sourceFilename(mimeType),
    mimeType,
    folderPath: GENERATED_IMAGES_FOLDER_PATH,
    source: 'session_output',
    sessionId: ctx.sessionRowId,
  });
  const stored = await resolveToolFile({ url: saved.url }, ctx);
  if (stored.source.kind !== 'blob') {
    throw new ToolError('TOOL_HANDLER_FAILED', 'Saved image has no storage path', {
      fileId: saved.id,
    });
  }
  return signedBlobUrl(stored.source.storagePath);
}

function assertImage(mimeType: string, label: string): void {
  if (!mimeType.startsWith('image/')) {
    throw new ToolError('TOOL_INPUT_INVALID', `${label} is not an image`, { mimeType });
  }
}

async function resolveSource(source: EditImageSource, ctx: ToolContext): Promise<string> {
  const resolved = await resolveToolFile(
    {
      libraryPath: source.library_path,
      name: source.name,
      outputFilename: source.output_filename,
      url: source.url,
    },
    ctx,
  );
  if (resolved.foundIn === 'url' && resolved.source.kind === 'url') {
    return importHttpsSource(resolved.source.url, ctx);
  }
  assertImage(resolved.mimeType, 'The source file');
  if (resolved.sizeBytes && resolved.sizeBytes > MAX_IMAGE_BYTES) {
    throw imageTooLarge(resolved.sizeBytes);
  }
  if (resolved.source.kind === 'url') return resolved.source.url;
  if (resolved.source.kind === 'blob') return signedBlobUrl(resolved.source.storagePath);

  const saved = await importDriveFile({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    bytes: resolved.source.bytes,
    filename: resolved.filename,
    mimeType: resolved.mimeType,
    folderPath: GENERATED_IMAGES_FOLDER_PATH,
    source: 'session_output',
    sessionId: ctx.sessionRowId,
  });
  if (resolved.sessionArtifactId) {
    const claimed = await claimArtifactSave({
      artifactId: resolved.sessionArtifactId,
      userId: ctx.userId,
      fileId: saved.id,
    });
    if (claimed && claimed.fileId !== saved.id) {
      // This person already has a Library copy of the output; use it.
      await discardImportedFile(saved.id);
      return signedBlobUrl(claimed.storagePath);
    }
  }
  const stored = await resolveToolFile({ url: saved.url }, ctx);
  if (stored.source.kind !== 'blob') {
    throw new ToolError('TOOL_HANDLER_FAILED', 'Saved image has no storage path', {
      fileId: saved.id,
    });
  }
  return signedBlobUrl(stored.source.storagePath);
}

function filenameFor(input: EditImageInput): string {
  if (input.operation === 'remove_background') return 'background-removed.png';
  if (input.operation === 'upscale') return 'upscaled-image.png';
  const slug = input.prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return `${slug || 'edited-image'}.png`;
}

async function saveProviderImage(
  bytes: Uint8Array<ArrayBuffer>,
  input: EditImageInput,
  ctx: ToolContext,
) {
  const saved = await importDriveFile({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    bytes,
    filename: filenameFor(input),
    mimeType: 'image/png',
    folderPath: GENERATED_IMAGES_FOLDER_PATH,
    source: 'agent_generated',
    sessionId: ctx.sessionRowId,
  });
  return {
    url: saved.url,
    filename: saved.filename,
    folderPath: saved.folderPath,
  };
}

function editEstimate(input: EditImageInput, storedDefault: GenerationQuality | undefined) {
  const quality = resolveEffectiveQuality(
    input.operation === 'edit' ? input.quality : 'mid',
    storedDefault,
  );
  const model = imageModelForBackground(editImageOptions(input).background);
  return { quality, estimatedCostCents: MEDIA_ESTIMATE_CENTS[model][quality] };
}

export const editImageTool: CustomTool<EditImageInput, EditImageOutput> = {
  ...EDIT_IMAGE_DECL,
  inputSchema: EditImageInputSchema,
  outputSchema: EditImageOutputSchema,
  accrualSource: 'generation',
  mediaBilling: (output) => output.mediaBilling,
  estimateCredits: (input, settings) =>
    creditsForVendorCents(editEstimate(input, settings.defaultQuality).estimatedCostCents),
  async handler(input, ctx) {
    const settings = await resolveToolSettings({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      toolName: EDIT_IMAGE_NAME,
    });
    const { quality, estimatedCostCents } = editEstimate(input, settings.defaultQuality);
    const options = editImageOptions(input);
    const images =
      input.operation === 'edit'
        ? await resolveSources(input.sources, ctx)
        : [await resolveSource(input.source, ctx)];
    const mask =
      input.operation === 'edit' && input.mask ? await resolveSource(input.mask, ctx) : undefined;
    const generated = await generateGatewayImage(capabilities.media, {
      ...options,
      images,
      quality: IMAGE_QUALITY[quality],
      ...(mask ? { mask } : {}),
    });
    return {
      model: generated.model,
      image: await saveProviderImage(generated.bytes, input, ctx).catch((cause: unknown) => {
        throw unsavedMediaError(
          { generationId: generated.generationId, model: generated.model, estimatedCostCents },
          cause,
        );
      }),
      operation: input.operation,
      quality,
      ...(input.operation === 'edit' ? { size: input.image_size } : {}),
      mediaBilling: {
        generationId: generated.generationId,
        model: generated.model,
        estimatedCostCents,
      },
    };
  },
};
