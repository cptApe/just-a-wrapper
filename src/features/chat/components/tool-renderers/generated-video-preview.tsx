'use client';

import { VIDEO_MODEL_ID } from '@/features/tool-catalog/generate-video';
import { videoMetaRows } from '../../lib/tool-display-details';
import { MediaDetailsPopover } from './media-details-popover';
import { mediaInputSchema, readGeneratedVideo } from './media-result';
import { MediaShimmer } from './media-shimmer';
import type { ToolRendererProps } from './tool-renderer-types';

// Live renderer for `generate_video`, the "shimmer treatment": running, a
// shimmer skeleton at the final aspect ratio under the shimmering activity
// line. Done: the clip alone, frameless (the registry marks generate_video
// `frameless`, so the line drops once the result is readable), via a plain
// <video controls> with a corner ⓘ popover for the prompt, meta, and Library
// location. The result contract is the tool's output schema
// (src/features/tool-catalog/generate-video.ts): `video.url` is the DURABLE Library
// URL the handler saved. A settled-ok result
// that can't be read never reaches here — the shell falls back to the standard
// Done card (registry `canRenderFrameless`).

/** Our aspect names → the running skeleton's sizing (aspect ratio + a width
 * capped so the box resolves to exactly what the settled `max-h-80` clip does;
 * static strings so Tailwind's JIT sees them). Falls back to wide (16:9). */
const VIDEO_SIZE_CLASS = {
  wide: 'aspect-video w-[min(100%,35.5556rem)]',
  portrait: 'aspect-[9/16] w-[min(100%,11.25rem)]',
  square: 'aspect-square w-[min(100%,20rem)]',
};

function videoSizeClass(input: Record<string, unknown>): string {
  switch (input.aspect) {
    case 'portrait':
      return VIDEO_SIZE_CLASS.portrait;
    case 'square':
      return VIDEO_SIZE_CLASS.square;
    default:
      return VIDEO_SIZE_CLASS.wide;
  }
}

export function GeneratedVideoPreview({ item, status }: ToolRendererProps) {
  if (status === 'running') {
    return <MediaShimmer sizeClassName={videoSizeClass(item.input)} />;
  }
  if (status !== 'done' || !item.result) return null;
  const video = readGeneratedVideo(item.result.text);
  if (!video) return null;
  const { prompt } = mediaInputSchema.parse(item.input);

  return (
    <div className="group relative w-fit max-w-full" data-testid="video-preview-frame">
      {/* Plain <video>, no autoplay (spec motion restraint: the user presses
          play). preload="metadata" paints the first frame as the poster without
          pulling the whole clip. */}
      <video
        src={video.url}
        aria-label={`Generated video: ${video.filename}`}
        controls
        preload="metadata"
        className="max-h-80 w-auto max-w-full rounded-xl"
        data-testid="video-preview"
      />
      <MediaDetailsPopover
        kind="video"
        prompt={prompt}
        metaRows={videoMetaRows({
          model: VIDEO_MODEL_ID,
          duration: video.duration,
          aspect: video.aspect,
        })}
        folderPath={video.folderPath}
      />
    </div>
  );
}
