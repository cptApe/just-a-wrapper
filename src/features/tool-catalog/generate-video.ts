import { z } from 'zod';
import { MediaBillingSchema } from '@/lib/media-billing';
import { MEDIA_GATE } from './gates';
import type { CustomToolDeclaration } from './types';

export const GENERATE_VIDEO_NAME = 'generate_video';
export const VIDEO_MODEL_ID = 'bytedance/seedance-2.5';

const VIDEO_QUALITIES = ['low', 'mid', 'high'] as const;
export type VideoQuality = (typeof VIDEO_QUALITIES)[number];
/** Default generation quality. */
const DEFAULT_VIDEO_QUALITY: VideoQuality = 'mid';

// Require a concrete duration so the agent cannot request an unbounded paid clip.
const VIDEO_DURATIONS = ['4', '8', '12', '15'] as const;
export type VideoDuration = (typeof VIDEO_DURATIONS)[number];
/** Default to the shortest clip to limit per-generation cost. */
const DEFAULT_VIDEO_DURATION: VideoDuration = '4';

const VIDEO_ASPECTS = ['wide', 'portrait', 'square'] as const;
export type VideoAspect = (typeof VIDEO_ASPECTS)[number];
const DEFAULT_VIDEO_ASPECT: VideoAspect = 'wide';

export const VIDEO_ASPECT: Record<VideoAspect, `${number}:${number}`> = {
  wide: '16:9',
  portrait: '9:16',
  square: '1:1',
};

export const GENERATE_VIDEO_DECL: CustomToolDeclaration<typeof GENERATE_VIDEO_NAME> = {
  gate: MEDIA_GATE,
  name: GENERATE_VIDEO_NAME,
  description:
    'Create a short video with native audio from a text description and save it into the workspace Library. Returns the saved file with a durable URL you can reference in your reply. Video costs far more credits than an image: keep the duration at 4 seconds unless the task clearly needs longer, and say the cost is higher when the user asks for long clips. Quality defaults to mid (720p), which suits almost every task; use high (1080p) only when the user asks for crisp or hero-quality footage, and low (480p) for quick drafts. Put spoken dialogue in double quotes in the prompt for lip-synced speech. Aspect defaults to wide (16:9); pick portrait or square for social formats. This is a built-in ability: no setup or connection is needed.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'What the video should show, in plain descriptive language. Dialogue in double quotes becomes lip-synced speech.',
        maxLength: 4000,
      },
      quality: {
        type: 'string',
        enum: [...VIDEO_QUALITIES],
        description:
          'Rendering quality: low (480p), mid (720p, default), or high (1080p). Higher quality costs more credits.',
      },
      duration: {
        type: 'string',
        enum: [...VIDEO_DURATIONS],
        description: 'Clip length in seconds. Default 4. Longer costs proportionally more credits.',
      },
      aspect: {
        type: 'string',
        enum: [...VIDEO_ASPECTS],
        description: 'Video shape: wide (default, 16:9), portrait (9:16), or square (1:1).',
      },
    },
    required: ['prompt'],
  },
};

export const GenerateVideoInputSchema = z.object({
  prompt: z.string().min(1).max(4000),
  quality: z.enum(VIDEO_QUALITIES).default(DEFAULT_VIDEO_QUALITY),
  duration: z.enum(VIDEO_DURATIONS).default(DEFAULT_VIDEO_DURATION),
  aspect: z.enum(VIDEO_ASPECTS).default(DEFAULT_VIDEO_ASPECT),
});

export type GenerateVideoInput = z.infer<typeof GenerateVideoInputSchema>;

export const GenerateVideoOutputSchema = z.object({
  video: z.object({
    /** Durable Library URL — what the agent references in its reply. */
    url: z.string(),
    filename: z.string(),
    folderPath: z.string(),
    sizeBytes: z.number().int().positive().optional(),
  }),
  quality: z.enum(VIDEO_QUALITIES),
  duration: z.enum(VIDEO_DURATIONS),
  aspect: z.enum(VIDEO_ASPECTS),
  /** Internal lookup metadata, stripped before the result reaches the agent. */
  mediaBilling: MediaBillingSchema,
});

export type GenerateVideoOutput = z.infer<typeof GenerateVideoOutputSchema>;

export const VIDEO_RESOLUTION = { low: '854x480', mid: '1280x720', high: '1920x1080' } as const;
