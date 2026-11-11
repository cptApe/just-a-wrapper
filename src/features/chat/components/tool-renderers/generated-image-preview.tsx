'use client';
import { type ReactNode } from 'react';

import { InlineImage } from '@/components/ui/inline-image';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import { useChatLibraryFiles } from '../../hooks/use-chat-library-files';
import { imageMetaRows } from '../../lib/tool-display-details';
import { MediaDetailsPopover } from './media-details-popover';
import { mediaInputSchema, readGeneratedImage } from './media-result';
import type { ToolRendererProps } from './tool-renderer-types';

// Width over height for each size the tool accepts (generate-image.ts).
const IMAGE_ASPECT_RATIO: Record<string, number> = {
  square: 1,
  portrait: 3 / 4,
  landscape: 4 / 3,
  wide: 16 / 9,
};

function imageAspectRatio(input: Record<string, unknown>): number {
  const { size } = mediaInputSchema.parse(input);
  return size === undefined ? 1 : (IMAGE_ASPECT_RATIO[size] ?? 1);
}

export function GeneratedImagePreview({ item, status }: ToolRendererProps) {
  const aspectRatio = imageAspectRatio(item.input);
  if (status === 'running') {
    return <InlineImage src="" alt="Generated image" loadingOnly aspectRatio={aspectRatio} />;
  }
  if (status !== 'done' || !item.result) return null;
  const image = readGeneratedImage(item.result.text);
  if (!image) return null;
  const { prompt } = mediaInputSchema.parse(item.input);
  const imageLabel = image.filename ?? 'Generated image';

  return (
    <ResolvedGeneratedImage
      src={image.url}
      alt={prompt ?? imageLabel}
      aspectRatio={aspectRatio}
      details={
        <MediaDetailsPopover
          kind="image"
          prompt={prompt}
          metaRows={imageMetaRows({
            model: image.model,
            size: image.size,
            quality: image.quality,
          })}
          folderPath={image.folderPath}
        />
      }
    />
  );
}

/** @public The image transition test renders it directly. */
export function ResolvedGeneratedImage({
  src,
  alt,
  aspectRatio,
  details,
}: {
  src: string;
  alt: string;
  aspectRatio: number;
  details: ReactNode;
}) {
  const library = useChatLibraryFiles(/^https?:/.test(src), src);
  const libraryId = library.data?.find((file) => file.url === src)?.id;

  return (
    <div className="group relative w-fit max-w-full" data-testid="image-preview-frame">
      <InlineImage
        src={src}
        alt={alt}
        aspectRatio={aspectRatio}
        onOpen={libraryId ? () => openOverlay(buildOverlayHash('file', libraryId)) : undefined}
        testId="image-preview"
      />
      {details}
    </div>
  );
}
