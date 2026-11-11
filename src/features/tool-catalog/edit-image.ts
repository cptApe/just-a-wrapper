import { z } from 'zod';
import { MediaBillingSchema } from '@/lib/media-billing';
import { MEDIA_GATE } from './gates';
import type { CustomToolDeclaration } from './types';

export const EDIT_IMAGE_NAME = 'edit_image';

const EDIT_QUALITIES = ['low', 'mid', 'high'] as const;
const EDIT_IMAGE_SIZES = [
  'auto',
  'square',
  'portrait_4_3',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_16_9',
] as const;
const EDIT_BACKGROUNDS = ['auto', 'transparent', 'opaque'] as const;
type EditImageQuality = (typeof EDIT_QUALITIES)[number];
const DEFAULT_EDIT_IMAGE_QUALITY: EditImageQuality = 'mid';
const sourceJsonSchema = {
  type: 'object',
  properties: {
    library_path: {
      type: 'string',
      description: 'Path to an existing image in the workspace Library.',
    },
    output_filename: {
      type: 'string',
      description: 'Filename of an image produced in the current agent session.',
    },
    name: {
      type: 'string',
      description:
        'A chat attachment name, a file id or name returned by an earlier tool, or "latest image".',
    },
    url: {
      type: 'string',
      format: 'uri',
      description: 'A publicly fetchable HTTPS image URL.',
    },
  },
  oneOf: [
    { required: ['library_path'] },
    { required: ['name'] },
    { required: ['output_filename'] },
    { required: ['url'] },
  ],
  additionalProperties: false,
} as const;

export const EDIT_IMAGE_DECL: CustomToolDeclaration<typeof EDIT_IMAGE_NAME> = {
  gate: MEDIA_GATE,
  name: EDIT_IMAGE_NAME,
  description:
    "Edit an existing image, remove its background, or upscale it, then save the result into the workspace Library. Use edit with up to 16 source images and a prompt, optionally with a mask. A source can be a Library path, a chat attachment name, a session output filename, a file id or name returned by an earlier tool, or a public HTTPS URL. Files made earlier in this session can also be called by name or as latest image. Edit quality uses low, mid, or high and defaults to the user's saved preference. Background removal requests a transparent PNG. Upscaling is a generative detail enhancement at the model output size, not a fixed enlargement; pixels and fine details may change. This is a built-in ability: no setup or connection is needed.",
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['edit', 'remove_background', 'upscale'],
      },
      prompt: { type: 'string', minLength: 1, maxLength: 4000 },
      sources: {
        type: 'array',
        items: sourceJsonSchema,
        minItems: 1,
        maxItems: 16,
      },
      source: sourceJsonSchema,
      mask: sourceJsonSchema,
      image_size: { type: 'string', enum: [...EDIT_IMAGE_SIZES] },
      background: { type: 'string', enum: [...EDIT_BACKGROUNDS] },
      quality: { type: 'string', enum: [...EDIT_QUALITIES] },
    },
    required: ['operation'],
  },
};

const EditImageSourceSchema = z
  .object({
    library_path: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    output_filename: z.string().min(1).optional(),
    url: z
      .string()
      .url()
      .refine((value) => value.startsWith('https://'), {
        message: 'Source URL must use HTTPS.',
      })
      .optional(),
  })
  .strict()
  .superRefine((source, issue) => {
    const count = [source.library_path, source.name, source.output_filename, source.url].filter(
      (value) => value !== undefined,
    ).length;
    if (count !== 1) {
      issue.addIssue({
        code: 'custom',
        message: 'Provide exactly one file source.',
      });
    }
  });

export type EditImageSource = z.infer<typeof EditImageSourceSchema>;

const editInput = z
  .object({
    operation: z.literal('edit'),
    prompt: z.string().min(1).max(4000),
    sources: z.array(EditImageSourceSchema).min(1).max(16),
    mask: EditImageSourceSchema.optional(),
    image_size: z.enum(EDIT_IMAGE_SIZES).default('auto'),
    background: z.enum(EDIT_BACKGROUNDS).default('auto'),
    quality: z.enum(EDIT_QUALITIES).default(DEFAULT_EDIT_IMAGE_QUALITY),
  })
  .strict();

const removeBackgroundInput = z
  .object({
    operation: z.literal('remove_background'),
    source: EditImageSourceSchema,
  })
  .strict();

const upscaleInput = z
  .object({
    operation: z.literal('upscale'),
    source: EditImageSourceSchema,
  })
  .strict();

export const EditImageInputSchema = z.discriminatedUnion('operation', [
  editInput,
  removeBackgroundInput,
  upscaleInput,
]);

export type EditImageInput = z.infer<typeof EditImageInputSchema>;

export const EditImageOutputSchema = z.object({
  model: z.string(),
  image: z.object({
    url: z.string(),
    filename: z.string(),
    folderPath: z.string(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }),
  operation: z.enum(['edit', 'remove_background', 'upscale']),
  quality: z.enum(EDIT_QUALITIES).optional(),
  size: z.enum(EDIT_IMAGE_SIZES).optional(),
  mediaBilling: MediaBillingSchema,
});

export type EditImageOutput = z.infer<typeof EditImageOutputSchema>;
