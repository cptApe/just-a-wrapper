import { z } from 'zod';
import { GENERATED_AUDIO_FOLDER_PATH, isValidSegment } from '@/features/files/lib/paths';
import { MAX_TTS_CHARS, VOICE_NAMES } from '@/features/voice/index';
import { ToolError } from '@/lib/errors';
import { MediaBillingSchema } from '@/lib/media-billing';
import { MEDIA_GATE } from './gates';
import { MAX_TOOL_TEXT_CHARS } from './lib/text-limits';
import type { CustomToolDeclaration } from './types';

function generatedAudioFilename(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return `${slug || 'generated-audio'}.mp3`;
}

export function mp3Filename(text: string, requested: string | undefined): string {
  const filename = requested ?? generatedAudioFilename(text);
  const normalized = filename.toLowerCase().endsWith('.mp3') ? filename : `${filename}.mp3`;
  if (!isValidSegment(normalized)) {
    throw new ToolError('TOOL_INPUT_INVALID', 'Invalid audio filename', { filename });
  }
  return normalized;
}

export function inlineTranscript(text: string): { text: string; truncated: boolean } {
  const truncated = text.length > MAX_TOOL_TEXT_CHARS;
  return {
    text: truncated ? `${text.slice(0, MAX_TOOL_TEXT_CHARS).trimEnd()}…` : text,
    truncated,
  };
}

export function transcriptFilename(sourceFilename: string): string {
  const stem = sourceFilename
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, '-')
    .replace(/^[. -]+/, '');
  return `${stem.slice(0, 120).replace(/[. ]+$/, '') || 'transcript'}.txt`;
}

export const GenerateAudioInputSchema = z.object({
  text: z.string().min(1).max(MAX_TTS_CHARS),
  voice: z.enum(VOICE_NAMES).optional(),
  filename: z.string().optional(),
  folder_path: z.string().default(GENERATED_AUDIO_FOLDER_PATH),
});

export const GenerateAudioOutputSchema = z.object({
  path: z.string(),
  url: z.string(),
  characters: z.number().int().positive(),
  mediaBilling: MediaBillingSchema,
});

const AudioSourceSchema = z
  .object({
    library_path: z.string().optional(),
    name: z.string().optional(),
    output_filename: z.string().optional(),
    url: z.string().url().optional(),
  })
  .superRefine((value, issue) => {
    const supplied = [value.library_path, value.name, value.output_filename, value.url].filter(
      (entry) => entry !== undefined,
    );
    if (supplied.length !== 1) {
      issue.addIssue({
        code: 'custom',
        message: 'Provide exactly one file source.',
      });
    }
  });

export const TranscribeAudioInputSchema = z.object({ source: AudioSourceSchema });
export const TranscribeAudioOutputSchema = z.object({
  text: z.string(),
  seconds: z.number().positive(),
  language: z.string().optional(),
  truncated: z.boolean(),
  path: z.string().optional(),
  mediaBilling: MediaBillingSchema,
});

export type GenerateAudioInput = z.infer<typeof GenerateAudioInputSchema>;
export type GenerateAudioOutput = z.infer<typeof GenerateAudioOutputSchema>;
export type TranscribeAudioInput = z.infer<typeof TranscribeAudioInputSchema>;
export type TranscribeAudioOutput = z.infer<typeof TranscribeAudioOutputSchema>;

export const GENERATE_AUDIO_DECL: CustomToolDeclaration<'generate_audio'> = {
  gate: MEDIA_GATE,
  name: 'generate_audio',
  description:
    'Turn up to 10,000 characters of text into an MP3 saved in the Library. This creates a file but does not play it or trigger read-aloud.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', minLength: 1, maxLength: MAX_TTS_CHARS },
      voice: {
        type: 'string',
        enum: [...VOICE_NAMES],
        description: 'Optional named voice. Omit it to use the built-in default.',
      },
      filename: { type: 'string', description: 'Optional destination MP3 filename.' },
      folder_path: {
        type: 'string',
        description: `Library destination folder. Defaults to ${GENERATED_AUDIO_FOLDER_PATH}.`,
      },
    },
    required: ['text'],
  },
};

export const TRANSCRIBE_AUDIO_DECL: CustomToolDeclaration<'transcribe_audio'> = {
  gate: MEDIA_GATE,
  name: 'transcribe_audio',
  description:
    "Transcribe an audio or video file from the Library, this chat's attachments, this session's outputs, files made earlier in this session, or a public HTTPS URL. Use a Library path, an attachment name, a session output filename, a file id or name returned by an earlier tool, or latest audio. Files are limited to 25 MB; trim longer recordings first. Long transcripts are shortened inline and saved in full to the Library.",
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'object',
        description: 'Provide exactly one source location.',
        properties: {
          library_path: { type: 'string', description: 'Full Library file path.' },
          name: {
            type: 'string',
            description:
              'A chat attachment name, a file id or name returned by an earlier tool, or "latest audio".',
          },
          output_filename: { type: 'string', description: 'Filename in this session outputs.' },
          url: { type: 'string', format: 'uri', description: 'Public HTTPS audio or video URL.' },
        },
        oneOf: [
          { required: ['library_path'] },
          { required: ['name'] },
          { required: ['output_filename'] },
          { required: ['url'] },
        ],
      },
    },
    required: ['source'],
  },
};
