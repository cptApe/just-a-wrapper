import { z } from 'zod';
import { MediaBillingSchema } from '@/lib/media-billing';
import { MEDIA_GATE } from './gates';
import type { CustomToolDeclaration } from './types';

export const GENERATE_IMAGE_NAME = 'generate_image';
export const IMAGE_MODEL_ID = 'openai/gpt-image-2.6-flare';
export const TRANSPARENT_IMAGE_MODEL_ID = 'openai/gpt-image-1.5';

// The GPT Image 2 line has no confirmed transparent output; select the transparency-capable model before calling Gateway.
export function imageModelForBackground(background: 'auto' | 'opaque' | 'transparent' | undefined) {
  return background === 'transparent' ? TRANSPARENT_IMAGE_MODEL_ID : IMAGE_MODEL_ID;
}

const IMAGE_QUALITIES = ['low', 'mid', 'high'] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
const DEFAULT_IMAGE_QUALITY: ImageQuality = 'mid';

const IMAGE_SIZES = ['square', 'portrait', 'landscape', 'wide'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
const DEFAULT_IMAGE_SIZE: ImageSize = 'square';

export const IMAGE_SIZE: Record<ImageSize, `${number}x${number}`> = {
  square: '1024x1024',
  portrait: '1024x1536',
  landscape: '1536x1024',
  wide: '1536x864',
};
export const IMAGE_QUALITY = { low: 'low', mid: 'medium', high: 'high' } as const;

export const GENERATE_IMAGE_DECL: CustomToolDeclaration<typeof GENERATE_IMAGE_NAME> = {
  gate: MEDIA_GATE,
  name: GENERATE_IMAGE_NAME,
  description:
    'Create an image from a text description and save it into the workspace Library. Returns the saved file with a durable URL you can reference in your reply. Quality defaults to mid, which suits almost every task; use high only when the user asks for print or hero-image polish, and low for quick throwaway drafts. Size defaults to a square; pick portrait, landscape, or wide when the use calls for it. This is a built-in ability: no setup or connection is needed.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'What the image should show, in plain descriptive language.',
        maxLength: 4000,
      },
      quality: {
        type: 'string',
        enum: [...IMAGE_QUALITIES],
        description: 'Rendering quality. Default mid. Higher quality costs more credits.',
      },
      size: {
        type: 'string',
        enum: [...IMAGE_SIZES],
        description: 'Image shape: square (default), portrait, landscape, or wide.',
      },
    },
    required: ['prompt'],
  },
};

export const GenerateImageInputSchema = z.object({
  prompt: z.string().min(1).max(4000),
  quality: z.enum(IMAGE_QUALITIES).default(DEFAULT_IMAGE_QUALITY),
  size: z.enum(IMAGE_SIZES).default(DEFAULT_IMAGE_SIZE),
});

export type GenerateImageInput = z.infer<typeof GenerateImageInputSchema>;

export const GenerateImageOutputSchema = z.object({
  model: z.string().optional(),
  image: z.object({
    /** Durable Library URL — what the agent references in its reply. */
    url: z.string(),
    filename: z.string(),
    folderPath: z.string(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }),
  quality: z.enum(IMAGE_QUALITIES),
  size: z.enum(IMAGE_SIZES),
  /** Internal lookup metadata, stripped before the result reaches the agent. */
  mediaBilling: MediaBillingSchema,
});

export type GenerateImageOutput = z.infer<typeof GenerateImageOutputSchema>;
