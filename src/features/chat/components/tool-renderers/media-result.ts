import { z } from 'zod';
import type { ToolChatItem } from '../../lib/chat-state';
import { lenientOptional } from '../../lib/lenient-optional';
import { parseResultObject } from '../../lib/tool-result-data';

// Tolerant readers for the two generated-media tools' settled results, plus the
// predicates the frameless card gate consults. A settled-ok result that can't
// be read (no durable URL) must fall back to the standard Done
// card rather than render an empty frame — `hasGeneratedImage` / `hasGeneratedVideo`
// are how the registry tells the shell that.

const mediaFileSchema = z.object({
  url: z.string().min(1),
  filename: lenientOptional(z.string()),
  folderPath: lenientOptional(z.string()),
});
const imageSchema = z
  .object({
    image: mediaFileSchema,
    model: lenientOptional(z.string()),
    size: lenientOptional(z.string()),
    quality: lenientOptional(z.string()),
  })
  .transform(({ image, ...metadata }) => ({ ...image, ...metadata }));
const videoSchema = z
  .object({
    video: mediaFileSchema,
    duration: lenientOptional(z.string()),
    aspect: lenientOptional(z.string()),
  })
  .transform(({ video, ...metadata }) => ({ ...video, ...metadata }));

type GeneratedImage = z.output<typeof imageSchema>;
type GeneratedVideo = z.output<typeof videoSchema>;

export function readGeneratedImage(text: string): GeneratedImage | null {
  const parsed = imageSchema.safeParse(parseResultObject(text));
  return parsed.success ? parsed.data : null;
}

export function readGeneratedVideo(text: string): GeneratedVideo | null {
  const parsed = videoSchema.safeParse(parseResultObject(text));
  return parsed.success ? parsed.data : null;
}

/** True when a settled generate_image result carries a renderable image. */
export function hasGeneratedImage(item: ToolChatItem): boolean {
  return item.result != null && readGeneratedImage(item.result.text) != null;
}

/** True when a settled generate_video result carries a renderable clip. */
export function hasGeneratedVideo(item: ToolChatItem): boolean {
  return item.result != null && readGeneratedVideo(item.result.text) != null;
}

export const mediaInputSchema = z.object({
  prompt: lenientOptional(z.string()),
  size: lenientOptional(z.string()),
});
